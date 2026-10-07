"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { createClient } from "@/lib/supabase/client";
import { extractNationalNumber, isValidKenyanMobile, toE164 } from "@/lib/phone";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB

function validateDob(dob) {
  if (!dob) return "Enter your date of birth.";
  const d = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "Enter a valid date of birth.";
  const now = new Date();
  if (d > now) return "Your date of birth can't be in the future.";
  if (d.getFullYear() < 1900) return "Enter a valid date of birth.";
  return null;
}

export default function ProfileSetupPage() {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState({ fullName: "", phone: "", dob: "" });
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Pre-fill the phone number given at signup so it only has to be confirmed.
  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const signupPhone = user?.user_metadata?.phone;
      if (signupPhone) {
        setForm((f) => (f.phone ? f : { ...f, phone: extractNationalNumber(signupPhone) }));
      }
    })();
  }, [supabase]);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  function onPhotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError("That photo is too large — please choose one under 5 MB.");
      return;
    }
    setError("");
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (form.fullName.trim().length < 2) {
      setError("Enter your full name.");
      return;
    }
    if (!isValidKenyanMobile(form.phone)) {
      setError("Enter a valid Kenyan mobile number — 9 digits after +254, starting with 7 or 1.");
      return;
    }
    const dobError = validateDob(form.dob);
    if (dobError) {
      setError(dobError);
      return;
    }

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
      // Build the storage path from a sanitised extension, never the raw file name.
      const ext = (photoFile.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
      const path = `${user.id}/${Date.now()}.${ext}`;
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
        full_name: form.fullName.trim(),
        phone: toE164(form.phone),
        dob: form.dob,
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

        <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
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
            <Input id="fullName" required autoComplete="name" value={form.fullName} onChange={update("fullName")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">Confirm phone number</Label>
            <PhoneInput id="phone" required value={form.phone}
              onChange={(national) => setForm((f) => ({ ...f, phone: national }))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dob">Date of birth</Label>
            <Input id="dob" type="date" required max={new Date().toISOString().slice(0, 10)}
              value={form.dob} onChange={update("dob")} />
          </div>

          {error && <p role="alert" className="text-sm text-danger">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Saving…" : "Continue to 2FA setup"}
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
