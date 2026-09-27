import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { BottomNav } from "@/components/bottom-nav";

export default async function DashboardLayout({ children }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main className="pb-24 md:ml-60 md:pb-10">
        <div className="mx-auto max-w-3xl px-5 pt-8 sm:px-8">{children}</div>
      </main>
      <BottomNav />
    </div>
  );
}
