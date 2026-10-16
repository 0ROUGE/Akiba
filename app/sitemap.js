import { getSiteUrl } from "@/lib/site-url";

// Only the public pages. Everything behind login is deliberately left out.
export default function sitemap() {
  const site = getSiteUrl();
  const lastModified = new Date();
  return [
    { url: `${site}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${site}/register`, lastModified, changeFrequency: "monthly", priority: 0.8 },
    { url: `${site}/login`, lastModified, changeFrequency: "monthly", priority: 0.5 },
  ];
}
