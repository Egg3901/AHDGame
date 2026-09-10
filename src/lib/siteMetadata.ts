import type { Metadata } from "next";
import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import {
  fallbackMarketedWorld,
  formatNationList,
  type MarketedWorld,
} from "@/lib/marketing/marketedWorld";

/**
 * Production canonical host (apex, non-www). Every other canonical reference
 * — robots.ts, sitemap.ts, Open Graph URLs, and the hardcoded `BASE_URL`
 * fallbacks in the Discord bot routes — must match this exact string to avoid
 * splitting SEO / Search Console signals between www and non-www variants.
 * The Vercel project should 301-redirect `www.` to this apex.
 */
const DEFAULT_SITE_URL = "https://ahousedividedgame.com";

export function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_BASE_URL?.trim().replace(/\/$/, "");
  if (raw?.startsWith("http://") || raw?.startsWith("https://")) {
    // Canonical host is the apex domain: normalize a stray `www.` env value so
    // canonicals, sitemap, and robots never split between www and non-www.
    return raw.replace(/^(https?:\/\/)www\./, "$1");
  }
  return DEFAULT_SITE_URL;
}

export function getCanonicalUrl(pathname: string): string {
  const base = getSiteUrl();
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${base}${path}`;
}

const DEFAULT_DOCS_URL = "https://docs.lakesidegames.net";
const WIKI_SITE_URL = "https://wiki.ahousedividedgame.com";

/** Public design/engineering docs host. Override with NEXT_PUBLIC_DOCS_URL. */
export function getDocsUrl(): string {
  const raw = process.env.NEXT_PUBLIC_DOCS_URL?.trim().replace(/\/$/, "");
  if (raw?.startsWith("http://") || raw?.startsWith("https://")) return raw;
  return DEFAULT_DOCS_URL;
}

export function getDesignDocUrl(slug: string): string {
  const path = slug.replace(/^\//, "");
  return `${getDocsUrl()}/${path}`;
}

/**
 * Canonical URL for wiki pages served from the subdomain.
 * Input: /wiki/president → https://wiki.ahousedividedgame.com/president
 * Input: /wiki → https://wiki.ahousedividedgame.com/
 */
export function getWikiCanonicalUrl(wikiPathname: string): string {
  const stripped = wikiPathname.replace(/^\/wiki/, "") || "/";
  const path = stripped.startsWith("/") ? stripped : `/${stripped}`;
  return `${WIKI_SITE_URL}${path}`;
}

export function getWikiSiteUrl(): string {
  return WIKI_SITE_URL;
}

export function wikiPublicPageMetadata(opts: {
  title: string;
  description: string;
  pathname: string;
}): Metadata {
  // Strip /wiki prefix — canonical lives at wiki.ahousedividedgame.com/<slug>
  const stripped = opts.pathname.replace(/^\/wiki/, "") || "/";
  const path = stripped.startsWith("/") ? stripped : `/${stripped}`;
  const url = `${WIKI_SITE_URL}${path}`;
  return {
    title: opts.title,
    description: opts.description,
    alternates: { canonical: url },
    openGraph: {
      title: opts.title,
      description: opts.description,
      url,
      type: "website",
      siteName: SITE_BRAND,
      locale: "en_US",
      images: [ogImageBlock],
    },
    twitter: {
      card: "summary_large_image",
      title: opts.title,
      description: opts.description,
      images: [OG_IMAGE_PATH],
    },
  };
}

export const SITE_BRAND = "A House Divided";
export const SITE_SUBTITLE = "Political & Economic Sim Game";

/**
 * Default unfurl / search snippet (no em dash), with the playable countries
 * filled in from the live registry. Never hardcode the list here: see `lib/marketing/marketedWorld`.
 */
export function buildSiteDescription(world: MarketedWorld): string {
  return `Real-time multiplayer political and economic simulation: run for office, pass legislation, build parties, run corporations, and trade markets in ${formatNationList(world.playable)}. The world advances every hour; progression never resets.`;
}

/**
 * Synchronous description for the handful of call sites that cannot await a
 * database read (JSON-LD built at module scope, error pages). Built from the
 * same registry, so it agrees with the async path except in the minutes after
 * an admin opens a country.
 */
export const DEFAULT_SITE_DESCRIPTION = buildSiteDescription(fallbackMarketedWorld());

// Served from the CDN (R2) so crawler unfurl fetches don't hit Railway egress.
const OG_IMAGE_PATH = CDN_LOGO_URL;

const ogImageBlock = {
  url: OG_IMAGE_PATH,
  width: 256,
  height: 256,
  alt: SITE_BRAND,
} as const;

/**
 * Merges explicit Open Graph and Twitter fields so link previews use the
 * page-specific title and description (not only the root layout defaults).
 */
export function publicPageMetadata(opts: {
  title: string;
  description: string;
  pathname: string;
}): Metadata {
  const url = getCanonicalUrl(opts.pathname);

  return {
    title: opts.title,
    description: opts.description,
    alternates: { canonical: url },
    openGraph: {
      title: opts.title,
      description: opts.description,
      url,
      type: "website",
      siteName: SITE_BRAND,
      locale: "en_US",
      images: [ogImageBlock],
    },
    twitter: {
      card: "summary_large_image",
      title: opts.title,
      description: opts.description,
      images: [OG_IMAGE_PATH],
    },
  };
}
