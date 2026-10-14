"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, Loader2, PiggyBank, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatKES, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { CountdownBadge } from "@/components/goal-countdown";
import { newGoalPhotoPath, storagePathFromUrl, validatePhoto } from "@/lib/photo-upload";

export function GoalCard({ goal }) {
  const supabase = createClient();
  const router = useRouter();
  const fileRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState("");

  const pct = goal.target_amount > 0
    ? Math.min(100, Math.round((goal.current_amount / goal.target_amount) * 100))
    : 0;

  async function handleAllocate(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Calls the same allocate_to_goal() Postgres function directly — it
    // checks your balance and moves the money atomically, so this one RPC
    // call is both the validation and the transfer.
    const { error } = await supabase.rpc("allocate_to_goal", {
      p_user_id: user.id,
      p_goal_id: goal.id,
      p_amount: Number(amount),
    });

    setSubmitting(false);
    if (error) {
      setError(error.message.includes("Insufficient") ? "Not enough in your AKIBA balance." : error.message);
      return;
    }
    setOpen(false);
    setAmount("");
    router.refresh();
  }

  async function handlePhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // lets the same file be picked again
    if (!file) return;
    setPhotoError("");
    const problem = validatePhoto(file);
    if (problem) {
      setPhotoError(problem);
      return;
    }

    setUploading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("no session");

      const path = newGoalPhotoPath(user.id, file);
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;

      const url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      const { error: updateError } = await supabase.from("savings_goals").update({ photo_url: url }).eq("id", goal.id);
      if (updateError) {
        await supabase.storage.from("avatars").remove([path]); // don't leave an orphan behind
        throw updateError;
      }

      // Best effort: delete the photo this one replaces.
      const oldPath = goal.photo_url ? storagePathFromUrl(goal.photo_url) : null;
      if (oldPath && oldPath.startsWith(`${user.id}/goals/`)) {
        supabase.storage.from("avatars").remove([oldPath]).catch(() => {});
      }
      router.refresh();
    } catch {
      setPhotoError("Couldn't save that photo. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {goal.photo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={goal.photo_url} alt="" loading="lazy" className="mb-3 h-28 w-full rounded-lg object-cover" />
      )}
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-medium">{goal.name}</h4>
        {goal.completed ? (
          <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">Reached</span>
        ) : (
          <CountdownBadge goal={goal} />
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {formatKES(goal.current_amount)} of {formatKES(goal.target_amount)}
        {goal.target_date && ` · by ${formatDate(goal.target_date)}`}
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full rounded-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {!goal.completed && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
            <PiggyBank size={14} /> Allocate funds
          </Button>
        )}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
          {goal.photo_url ? "Change photo" : "Add photo"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
          className="hidden"
          onChange={handlePhoto}
        />
      </div>
      {photoError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {photoError}
        </p>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              onClick={(e) => e.stopPropagation()}
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ type: "spring", stiffness: 340, damping: 32 }}
              className="w-full max-w-sm rounded-t-2xl bg-card p-6 sm:rounded-2xl"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-display text-lg font-medium">Allocate to {goal.name}</h3>
                <button onClick={() => setOpen(false)} aria-label="Close">
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleAllocate} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="allocate-amount">Amount (KES)</Label>
                  <Input
                    id="allocate-amount"
                    type="number"
                    min="1"
                    required
                    autoFocus
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                {error && <p className="text-sm text-danger">{error}</p>}
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "Allocating…" : "Allocate from balance"}
                </Button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
