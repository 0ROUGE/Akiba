import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Web Share Target endpoint — lets AKIBA appear in the OS "Share to…" sheet
// for images (e.g. sharing a photo straight into your profile picture
// without opening the app and navigating to Account → Edit first).
export async function POST(request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const redirectUrl = new URL("/dashboard/account", request.url);

  if (!user) {
    redirectUrl.pathname = "/login";
    return NextResponse.redirect(redirectUrl, 303);
  }

  const formData = await request.formData();
  const file = formData.get("files");

  if (file && typeof file === "object" && "arrayBuffer" in file) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const path = `${user.id}/${Date.now()}-shared-${file.name || "photo"}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, buffer, { contentType: file.type || "image/jpeg", upsert: true });

    if (!uploadError) {
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      await supabase.from("profiles").update({ photo_url: data.publicUrl }).eq("id", user.id);
      redirectUrl.searchParams.set("shared", "1");
    } else {
      redirectUrl.searchParams.set("shareError", "1");
    }
  }

  return NextResponse.redirect(redirectUrl, 303);
}
