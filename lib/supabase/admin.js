import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client for server-only code that must bypass RLS: Daraja
// callback webhooks and anything writing to ledger_transactions/notifications,
// which clients are deliberately not allowed to insert into directly.
// NEVER import this from a Client Component or expose SUPABASE_SERVICE_ROLE_KEY
// to the browser.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
