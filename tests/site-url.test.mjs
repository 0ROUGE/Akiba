import test from "node:test";
import assert from "node:assert/strict";
import { getSiteUrl } from "../lib/site-url.js";

test("getSiteUrl is safe for any NEXT_PUBLIC_APP_URL value", () => {
  assert.equal(getSiteUrl("https://akiba1.vercel.app/"), "https://akiba1.vercel.app");
  assert.equal(getSiteUrl("akiba1.vercel.app"), "https://akiba1.vercel.app");
  assert.equal(getSiteUrl("  https://akiba1.vercel.app///  "), "https://akiba1.vercel.app");
  assert.equal(getSiteUrl(""), "https://akiba1.vercel.app");
  assert.equal(getSiteUrl(undefined), "https://akiba1.vercel.app");
  assert.equal(getSiteUrl("http://localhost:3000"), "http://localhost:3000");
});
