import test from "node:test";
import assert from "node:assert/strict";
import { PHOTO_MAX_BYTES, newGoalPhotoPath, photoExtension, storagePathFromUrl, uniqueId, validatePhoto } from "../lib/photo-upload.js";

const file = (type, size = 1000) => ({ type, size });
const UID = "9825897c-22f2-4860-adf7-640d15a5251a";

test("accepts the five image types the bucket allows", () => {
  for (const t of ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]) {
    assert.equal(validatePhoto(file(t)), null, t);
  }
});

test("rejects other types, including images the bucket would refuse", () => {
  for (const t of ["image/svg+xml", "image/heic", "application/pdf", "text/html", "", undefined]) {
    assert.ok(validatePhoto(file(t)), String(t));
  }
  assert.ok(validatePhoto(null));
  assert.ok(validatePhoto(undefined));
});

test("enforces the 5 MB limit exactly", () => {
  assert.equal(validatePhoto(file("image/png", PHOTO_MAX_BYTES)), null);
  assert.ok(validatePhoto(file("image/png", PHOTO_MAX_BYTES + 1)));
});

test("the extension comes from the MIME type, never from the file name", () => {
  assert.equal(photoExtension({ type: "image/jpeg", name: "evil.html" }), "jpg");
  assert.equal(photoExtension(file("image/webp")), "webp");
  assert.equal(photoExtension(file("image/avif")), "avif");
  assert.equal(photoExtension(file("image/png")), "png");
  assert.equal(photoExtension(file("image/gif")), "gif");
  assert.equal(photoExtension(undefined), "jpg");
});

test("goal photo paths sit inside the owner's folder, where the storage policy allows writes", () => {
  assert.equal(newGoalPhotoPath(UID, file("image/png"), "abc"), `${UID}/goals/abc.png`);
  assert.match(newGoalPhotoPath(UID, file("image/jpeg")), new RegExp(`^${UID}/goals/[A-Za-z0-9-]+\\.jpg$`));
  assert.notEqual(uniqueId(), uniqueId());
});

test("storagePathFromUrl extracts the object path, and refuses other buckets and junk", () => {
  const url = `https://abc.supabase.co/storage/v1/object/public/avatars/${UID}/goals/a%20b.jpg?t=123`;
  assert.equal(storagePathFromUrl(url), `${UID}/goals/a b.jpg`);
  assert.equal(storagePathFromUrl(`https://abc.supabase.co/storage/v1/object/public/other/${UID}/x.jpg`), null);
  assert.equal(storagePathFromUrl("https://example.com/photo.jpg"), null);
  assert.equal(storagePathFromUrl("not a url"), null);
  assert.equal(storagePathFromUrl(null), null);
});
