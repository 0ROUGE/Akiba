import { createClient } from "@/lib/supabase/server";
import { GoalCard } from "@/components/goal-card";
import { NewGoalDialog } from "@/components/new-goal-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { PlusCircle } from "lucide-react";

export default async function GoalsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: goals } = await supabase
    .from("savings_goals")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6 pb-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold">Savings goals</h1>
      </div>

      <div className="max-w-[220px]">
        <NewGoalDialog />
      </div>

      {goals?.length ? (
        <div className="space-y-3">
          {goals.map((g) => (
            <GoalCard key={g.id} goal={g} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <PlusCircle className="text-muted-foreground" size={22} />
            <p className="text-sm text-muted-foreground">
              No goals yet. Create one and allocate from your balance whenever you like.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
