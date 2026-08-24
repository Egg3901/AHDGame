import type { MetadataRoute } from "next";
import { getDb } from "@/lib/mongodb";
import { getGameStateCollection } from "@/lib/db/collections";
import { getSiteUrl } from "@/lib/siteMetadata";
import { getAllWikiPagesForDisplay } from "@/lib/wiki/getWikiPageData";
import { getCategoryById } from "@/lib/wiki/categories";
import { getStarterStubSlugs } from "@/lib/wiki/starterStub";
import { loadPublicPosts } from "@/lib/changelog/posts";

/**
 * Rendered per request, never prerendered at build.
 *
 * This route reads live game state and wiki rows, and it deliberately THROWS when
 * those queries fail (see the two catch blocks below — a 500 makes crawlers retry and keep
 * the previous sitemap, whereas a 200 missing most of its URLs de-lists those pages).
 *
 * Next prerenders metadata routes during `next build`, so that same deliberate throw took
 * the production build down: Railway's `mongodb.railway.internal` only resolves inside the
 * runtime private network, not in the build container, so the query fails with ENOTFOUND
 * and `Export encountered an error on /sitemap.xml/route` exits the build.
 *
 * Marking it dynamic is the honest fix rather than a build-time special case: a sitemap of
 * live database rows was never a build-time artifact, and this keeps the runtime failure
 * semantics exactly as they are.
 */
export const dynamic = "force-dynamic";

const GUIDE_ROUTES = [
  "/guides",
  "/guides/bonds",
  "/guides/commodities",
  "/guides/corporations",
  "/guides/forex",
  "/guides/investing",
  "/guides/planned-economies",
  "/guides/running-for-office",
  "/guides/running-for-office/us",
  "/guides/running-for-office/intl",
  "/guides/api-automation",
] as const;

const STATIC_PUBLIC_ROUTES: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}> = [
  { path: "/about", changeFrequency: "monthly", priority: 0.6 },
  { path: "/faq", changeFrequency: "monthly", priority: 0.5 },
  { path: "/api-guide", changeFrequency: "monthly", priority: 0.5 },
  { path: "/contact", changeFrequency: "yearly", priority: 0.4 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/changelog", changeFrequency: "weekly", priority: 0.65 },
  { path: "/changelog/legacy", changeFrequency: "monthly", priority: 0.4 },
  { path: "/news", changeFrequency: "daily", priority: 0.8 },
  { path: "/world", changeFrequency: "daily", priority: 0.85 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getSiteUrl();
  const communityCategoryIds = new Set(["characters", "corporations", "player-parties", "events"]);

  // Check if wiki is disabled to exclude it from the sitemap
  let wikiDisabled = false;
  let wikiEntries: MetadataRoute.Sitemap = [];
  let wikiCategoryEntries: MetadataRoute.Sitemap = [];
  try {
    const db = await getDb();
    const col = await getGameStateCollection(db);
    const gameState = await col.findOne({ _id: "current" }, { projection: { wikiDisabled: 1 } });
    wikiDisabled = gameState?.wikiDisabled ?? false;
  } catch (error) {
    // Fail the whole route rather than serve a sitemap silently missing a
    // cohort: crawlers treat a 500 as retry-later and keep the previous
    // sitemap, but a 200 with the URLs absent de-lists them.
    console.error("sitemap: game state query failed", error);
    throw error;
  }

  const entries: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1.0,
    },
  ];

  entries.push(
    ...STATIC_PUBLIC_ROUTES.map(({ path, changeFrequency, priority }) => ({
      url: `${baseUrl}${path}`,
      lastModified: new Date(),
      changeFrequency,
      priority,
    })),
    ...GUIDE_ROUTES.map((path) => ({
      url: `${baseUrl}${path}`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: path === "/guides" ? 0.75 : 0.7,
    })),
    // Release posts are file-based and statically rendered, so this adds no
    // runtime dependency. /country/* routes are deliberately absent: they are
    // client-rendered stat surfaces with almost no server-side text and carry
    // noindex (see src/app/country/[code]/layout.tsx). /news/post/* is absent
    // for the same reason: every permalink is a few dozen words of player
    // writing and all of them are noindex (see src/app/news/post/[id]/page.tsx).
    ...loadPublicPosts().map((post) => ({
      url: `${baseUrl}/changelog/${post.slug}`,
      lastModified: new Date(post.date),
      changeFrequency: "yearly" as const,
      priority: 0.6,
    }))
  );

  if (!wikiDisabled) {
    entries.push({
      url: `${baseUrl}/wiki`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.9,
    });
    try {
      const allWikiPages = await getAllWikiPagesForDisplay();
      // Pages still on their unedited starter template are scaffolds, not
      // content, and they are served noindex. Submitting a noindexed URL is
      // reported as an error in Search Console, so drop them here too.
      const stubSlugs = new Set(await getStarterStubSlugs());
      const wikiPages = allWikiPages.filter((page) => !stubSlugs.has(page.slug));
      const categoryLastModified = new Map<string, Date>();

      for (const page of wikiPages) {
        if (!page.category || communityCategoryIds.has(page.category)) continue;
        const currentLastModified = categoryLastModified.get(page.category);
        const pageLastModified = page.updatedAt ?? new Date();
        if (!currentLastModified || pageLastModified > currentLastModified) {
          categoryLastModified.set(page.category, pageLastModified);
        }
      }

      wikiCategoryEntries = [];
      for (const [categoryId, lastModified] of categoryLastModified.entries()) {
        const category = getCategoryById(categoryId);
        if (!category) continue;
        wikiCategoryEntries.push({
          url: `${baseUrl}/wiki/category/${category.slug}`,
          lastModified,
          changeFrequency: "weekly",
          priority: categoryId === "getting-started" ? 0.9 : 0.72,
        });
      }

      wikiEntries = wikiPages.map((page) => ({
        url: `${baseUrl}/wiki/${page.slug}`,
        lastModified: page.updatedAt ?? new Date(),
        changeFrequency: "monthly" as const,
        priority:
          page.slug === "getting-started"
            ? 0.9
            : page.slug === "first-campaign-walkthrough"
              ? 0.82
              : page.featured
                ? 0.75
                : 0.65,
      }));
    } catch (error) {
      // The wiki is ~3/4 of the sitemap. Serving a 200 without it (observed
      // live 2026-08-09: 233 URLs degraded to 59 on a query blip) tells
      // crawlers those pages are gone; a 500 tells them to come back later.
      console.error("sitemap: wiki page query failed", error);
      throw error;
    }
  }

  entries.push(...wikiCategoryEntries, ...wikiEntries);

  return entries;
}
