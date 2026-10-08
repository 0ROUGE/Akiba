import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { BottomNav } from "@/components/bottom-nav";
import { IdleLogoutGuard } from "@/components/idle-logout-guard";
import { AwayLogoutGuard } from "@/components/away-logout-guard";

export default async function DashboardLayout({ children }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Lets the away-guard ignore "last seen" stamps left over from an older session.
  const signedInAt = user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : null;

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <IdleLogoutGuard />
      <AwayLogoutGuard signedInAt={signedInAt} />
      <main className="pb-24 md:ml-60 md:pb-10">
        <div className="mx-auto max-w-3xl px-5 pt-8 sm:px-8">{children}</div>
      </main>
      <BottomNav />
    </div>
  );
}
