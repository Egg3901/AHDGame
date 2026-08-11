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
