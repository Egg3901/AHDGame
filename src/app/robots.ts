import type { MetadataRoute } from "next";
import { getCanonicalUrl } from "@/lib/siteMetadata";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/wiki/*",
          "/guides/*",
          "/changelog",
          "/news",
          // Stays allowed on purpose while the permalinks carry noindex. A
          // crawler has to fetch a page to see its noindex, so disallowing the
          // path now would freeze the already-indexed URLs in place instead of
          // dropping them. Switch this to disallow once they are out of the
          // index (see src/app/news/post/[id]/page.tsx).
          "/news/post/*",
          "/world",
          "/privacy",
          "/terms",
          "/about",
          "/contact",
        ],
        disallow: [
          "/login",
          "/register",
          "/dashboard",
          "/profile",
          "/settings",
          "/campaign",
          "/actions",
          "/admin/*",
          "/api/*",
          "/notifications",
          "/portfolio",
          "/approval",
          "/player-ads",
        ],
      },
    ],
    sitemap: getCanonicalUrl("/sitemap.xml"),
  };
}
