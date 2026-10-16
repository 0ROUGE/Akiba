// The public address of the site, used for the sitemap and robots.txt.
// Defensive on purpose: a missing protocol or trailing slash in NEXT_PUBLIC_APP_URL
// must never be able to break the build or produce broken sitemap links.
export function getSiteUrl(raw = process.env.NEXT_PUBLIC_APP_URL) {
  let url = String(raw ?? "").trim();
  if (!url) url = "https://akiba1.vercel.app";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, "");
}
