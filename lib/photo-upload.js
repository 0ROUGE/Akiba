// Goal photo helpers. Pure functions (no framework imports) so they are unit-tested.
// The same rules are enforced again by the storage bucket (5 MB, images only).

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const TYPES = /^image\/(jpeg|png|webp|gif|avif)$/;
const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

export function validatePhoto(file) {
  if (!file) return "Choose a photo.";
  if (!TYPES.test(file.type)) return "Use a JPG, PNG, WebP, GIF or AVIF image.";
  if (file.size > PHOTO_MAX_BYTES) return "That photo is over 5 MB. Pick a smaller one.";
  return null;
}

// The extension comes from the verified MIME type, never from the user's file name.
export function photoExtension(file) {
  return EXTENSIONS[file?.type] ?? "jpg";
}

export function uniqueId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function newGoalPhotoPath(userId, file, id = uniqueId()) {
  return `${userId}/goals/${id}.${photoExtension(file)}`;
}

// "https://x.supabase.co/storage/v1/object/public/avatars/<uid>/goals/a.jpg?t=1" -> "<uid>/goals/a.jpg".
// null if the URL isn't a public object in that bucket.
export function storagePathFromUrl(url, bucket = "avatars") {
  try {
    const u = new URL(url);
    const marker = `/object/public/${bucket}/`;
    const i = u.pathname.indexOf(marker);
    if (i < 0) return null;
    return decodeURIComponent(u.pathname.slice(i + marker.length));
  } catch {
    return null;
  }
}
