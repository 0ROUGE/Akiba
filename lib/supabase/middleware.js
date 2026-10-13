import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { verifyToken } from "@/lib/signed-cookie";
import { TWO_FA_COOKIE } from "@/lib/two-fa-session";

export async function updateSession(request) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If there's no session any more (manual sign-out, idle/away auto-logout,
  // expiry) but the "passed 2FA" cookie is still around, drop it. Otherwise
  // logging back in as the same user within its 12h lifetime would silently
  // skip the 2FA prompt - the spec requires 2FA on every login.
  const staleTwoFaCookie = !user && request.cookies.has(TWO_FA_COOKIE);
  const finish = (res) => {
    if (staleTwoFaCookie) res.cookies.set(TWO_FA_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  const path = request.nextUrl.pathname;
  const isAuthRoute = path.startsWith("/login") || path.startsWith("/register");
  const isProtectedRoute = path.startsWith("/dashboard");
  const isOnboardingRoute =
    path.startsWith("/profile-setup") || path.startsWith("/two-factor-setup") || path.startsWith("/verify-2fa");

  if (!user && (isProtectedRoute || isOnboardingRoute)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return finish(NextResponse.redirect(url));
  }

  // Require a fresh TOTP check before /dashboard/* on any session that hasn't
  // passed one yet. The cookie is a SIGNED token (set by /api/2fa/verify or by a
  // verified passkey login), so it can't be forged from a password-only session.
  // The profile lookup only runs when the token is missing/invalid: once it is
  // valid every later navigation skips the DB round-trip entirely.
  if (user && isProtectedRoute) {
    const valid = await verifyToken("2fa", request.cookies.get(TWO_FA_COOKIE)?.value, user.id);
    if (!valid) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("two_factor_enabled")
        .eq("id", user.id)
        .single();

      if (profile?.two_factor_enabled) {
        const url = request.nextUrl.clone();
        url.pathname = "/verify-2fa";
        return NextResponse.redirect(url);
      }
    }
  }

  // Logged in + landed on the marketing page or an auth page -> straight into the portal.
  if (user && (path === "/" || isAuthRoute)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return finish(response);
}
