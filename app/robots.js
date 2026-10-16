import { getSiteUrl } from "@/lib/site-url";

// Search engines may crawl the public pages. Everything private - the signed-in app,
// API routes, and account-setup / password-reset screens - is kept out of the index.
export default function robots() {
  const site = getSiteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard",
          "/api/",
          "/profile-setup",
          "/two-factor-setup",
          "/verify-2fa",
          "/forgot-password",
          "/reset-password",
        ],
      },
    ],
    sitemap: `${site}/sitemap.xml`,
    host: site,
  };
}
