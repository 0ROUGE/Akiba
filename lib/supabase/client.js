import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      // Passkeys (WebAuthn — Face ID / Touch ID / Android fingerprint /
      // Windows Hello) are beta in Supabase Auth and require this opt-in.
      // Only the browser client needs it; the ceremony itself
      // (navigator.credentials.create/get) only runs client-side.
      auth: { experimental: { passkey: true } },
    }
  );
}
