"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { newGoalPhotoPath, validatePhoto } from "@/lib/photo-upload";

function friendlyGoalError(message = "") {
  if (message.includes("ERR_GOAL_RATE")) return "You've created a lot of goals in the last hour. Please wait a little and try again.";
  if (message.includes("ERR_GOAL_LIMIT")) return "You have 50 open goals, the most AKIBA allows. Finish or remove one first.";
  if (message.includes("savings_goals_name_len")) return "Goal names must be 1 to 80 characters.";
  return "Couldn't create that goal. Please try again.";
}

export function NewGoalDialog({ defaultOpen = false }) {
  const supabase = createClient();
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", target_amount: "", target_date: "" });
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  function onPhotoChange(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const problem = validatePhoto(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  function resetForm() {
    setForm({ name: "", target_amount: "", target_date: "" });
    setPhotoFile(null);
    setPhotoPreview(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSubmitting(false);
      setError("Your session expired — please log in again.");
      return;
    }

    // Photo first (optional). A photo that fails to upload shouldn't stop the goal, but we say so.
    let photo_url = null;
    let uploadedPath = null;
    if (photoFile) {
      const path = newGoalPhotoPath(user.id, photoFile);
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, photoFile, { contentType: photoFile.type, upsert: false });
      if (uploadError) {
        setSubmitting(false);
        setError("Couldn't upload that photo. Try another one, or remove it and create the goal without.");
        return;
      }
      uploadedPath = path;
      photo_url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    }

    const { error: insertError } = await supabase.from("savings_goals").insert({
      user_id: user.id,
      name: form.name.trim(),
      target_amount: Number(form.target_amount),
      target_date: form.target_date || null,
      ...(photo_url ? { photo_url } : {}),
    });

    setSubmitting(false);
    if (insertError) {
      if (uploadedPath) await supabase.storage.from("avatars").remove([uploadedPath]); // no orphan photo
      setError(friendlyGoalError(insertError.message));
      return;
    }
    setOpen(false);
    resetForm();
    router.refresh();
  }

  return (
    <>
      <Button variant="outline" className="h-auto w-full flex-col gap-1.5 py-4" onClick={() => setOpen(true)}>
        <Plus size={18} />
        <span className="text-xs">New goal</span>
      </Button>

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
              className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-t-2xl bg-card p-6 sm:rounded-2xl"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-display text-lg font-medium">New savings goal</h3>
                <button onClick={() => setOpen(false)} aria-label="Close">
                  <X size={18} />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <label
                  htmlFor="goal-photo"
                  className="flex h-28 w-full cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-xl border border-dashed border-border bg-muted text-sm text-muted-foreground"
                >
                  {photoPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoPreview} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <>
                      <Camera size={18} /> Add a photo (optional)
                    </>
                  )}
                </label>
                <input
                  id="goal-photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
                  className="hidden"
                  onChange={onPhotoChange}
                />
                <div className="space-y-1.5">
                  <Label htmlFor="goal-name">Goal name</Label>
                  <Input id="goal-name" required maxLength={80} value={form.name} onChange={update("name")} placeholder="Laptop fund" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="goal-target">Target amount (KES)</Label>
                  <Input id="goal-target" type="number" min="1" required value={form.target_amount} onChange={update("target_amount")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="goal-date">Target date (optional)</Label>
                  <Input id="goal-date" type="date" value={form.target_date} onChange={update("target_date")} />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-danger">
                    {error}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? "Creating…" : "Create goal"}
                </Button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
