import Link from "next/link";
import { PlusCircle, ArrowDownToLine, ArrowUpFromLine, Target } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { BalanceCard } from "@/components/balance-card";
import { GoalCard } from "@/components/goal-card";
import { TransactionRow } from "@/components/transaction-row";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export default async function DashboardHomePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: profile }, { data: balanceRow }, { data: goals }, { data: transactions }] =
    await Promise.all([
      supabase.from("profiles").select("full_name").eq("id", user.id).single(),
      supabase.from("akiba_balances").select("balance").eq("user_id", user.id).maybeSingle(),
      supabase
        .from("savings_goals")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(3),
      supabase
        .from("ledger_transactions")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

  const pendingCount =
    transactions?.filter((t) => t.mpesa_transaction_status === "pending").length ?? 0;
  const firstName = profile?.full_name?.split(" ")[0];

  return (
    <div className="space-y-8 pb-6">
      <div>
        <p className="text-sm text-muted-foreground">
          {new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening"}
        </p>
        <h1 className="font-display text-2xl font-semibold">{firstName || "Karibu"}</h1>
      </div>

      <BalanceCard balance={balanceRow?.balance ?? 0} pendingCount={pendingCount} />

      <div className="grid grid-cols-3 gap-3">
        <Link href="/dashboard/balance?action=deposit">
          <Button variant="outline" className="w-full flex-col gap-1.5 py-4 h-auto">
            <ArrowDownToLine size={18} />
            <span className="text-xs">Deposit</span>
          </Button>
        </Link>
        <Link href="/dashboard/balance?action=withdraw">
          <Button variant="outline" className="w-full flex-col gap-1.5 py-4 h-auto">
            <ArrowUpFromLine size={18} />
            <span className="text-xs">Withdraw</span>
          </Button>
        </Link>
        <Link href="/dashboard?newGoal=1">
          <Button variant="outline" className="w-full flex-col gap-1.5 py-4 h-auto">
            <Target size={18} />
            <span className="text-xs">New goal</span>
          </Button>
        </Link>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-medium">Savings goals</h2>
          <Link href="/dashboard/balance" className="text-sm font-medium text-primary">
            View all
          </Link>
        </div>
        {goals?.length ? (
          <div className="space-y-3">
            {goals.map((g) => <GoalCard key={g.id} goal={g} />)}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
              <PlusCircle className="text-muted-foreground" size={22} />
              <p className="text-sm text-muted-foreground">
                No goals yet. Set one and allocate from your balance whenever you like.
              </p>
            </CardContent>
          </Card>
        )}
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-display text-lg font-medium">Recent activity</h2>
          <Link href="/dashboard/spending" className="text-sm font-medium text-primary">
            View all
          </Link>
        </div>
        <Card>
          <CardContent className="divide-y divide-border p-0 px-5">
            {transactions?.length ? (
              transactions.map((tx) => <TransactionRow key={tx.id} tx={tx} />)
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing yet — your first deposit will show up here.
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
