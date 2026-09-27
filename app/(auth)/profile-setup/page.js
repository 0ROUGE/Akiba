"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

export default function ProfileSetupPage() {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState({ fullName: "", phone: "", dob: "" });
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  function onPhotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Your session expired — please log in again.");
      setLoading(false);
      return;
    }

    let photo_url = null;
    if (photoFile) {
      const path = `${user.id}/${Date.now()}-${photoFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, photoFile, { upsert: true });
      if (uploadError) {
        setError(uploadError.message);
        setLoading(false);
        return;
      }
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      photo_url = data.publicUrl;
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        full_name: form.fullName,
        phone: form.phone,
        dob: form.dob || null,
        ...(photo_url ? { photo_url } : {}),
      })
      .eq("id", user.id);

    setLoading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.replace("/two-factor-setup");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm"
      >
        <p className="text-sm font-medium text-primary">Step 1 of 2</p>
        <h1 className="mt-2 font-display text-2xl font-semibold">Complete your profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This helps us confirm it&rsquo;s really you when money moves.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <label
            htmlFor="photo"
            className="mx-auto flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-dashed border-border bg-muted"
          >
            {photoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoPreview} alt="" className="h-full w-full object-cover" />
            ) : (
              <Camera size={22} className="text-muted-foreground" />
            )}
          </label>
          <input id="photo" type="file" accept="image/*" className="hidden" onChange={onPhotoChange} />

          <div className="space-y-1.5">
            <Label htmlFor="fullName">Full name</Label>
            <Input id="fullName" required value={form.fullName} onChange={update("fullName")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Confirm phone number</Label>
            <Input id="phone" type="tel" required placeholder="07XX XXX XXX" value={form.phone} onChange={update("phone")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dob">Date of birth</Label>
            <Input id="dob" type="date" required value={form.dob} onChange={update("dob")} />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Saving…" : "Continue to 2FA setup"}
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
