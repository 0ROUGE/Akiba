import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";

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

  const path = request.nextUrl.pathname;
  const isAuthRoute = path.startsWith("/login") || path.startsWith("/register");
  const isProtectedRoute = path.startsWith("/dashboard");
  const isOnboardingRoute =
    path.startsWith("/profile-setup") || path.startsWith("/two-factor-setup") || path.startsWith("/verify-2fa");

  if (!user && (isProtectedRoute || isOnboardingRoute)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Require a fresh TOTP check before /dashboard/* on any session that
  // hasn't passed one yet — set by /api/2fa/verify, scoped to this user id.
  // The profile lookup only runs once per session: if the cookie already
  // matches this user, every later navigation skips the DB round-trip
  // entirely (this was the main cause of slow page-to-page navigation).
  if (user && isProtectedRoute) {
    const verifiedCookie = request.cookies.get("akiba_2fa_ok")?.value;
    if (verifiedCookie !== user.id) {
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

  // Logged in + landed on the marketing page or an auth page → straight into the portal.
  if (user && (path === "/" || isAuthRoute)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}
