/**
 * Cloudflare R2 static asset URLs (`cdn.ahousedividedgame.com/static/…`).
 * Image files are published via `scripts/fetch-all-static-images.mjs` and
 * `scripts/upload-all-static-images-via-railway.mjs`.
 *
 * Matched by `bypassNextImageOptimization` — pass `unoptimized` to `next/image`.
 */
export const CDN_BASE = "https://cdn.ahousedividedgame.com";

export function cdnStatic(category: string, slug: string, ext: "webp" | "png" = "webp"): string {
  return `${CDN_BASE}/static/${category}/${slug}.${ext}`;
}

/** Hero banner slugs served by `/api/images/hero/[slug]` (and direct CDN use). */
export type HeroSlug =
  | "white-house"
  | "cabinet"
  | "actions"
  | "politicians"
  | "parties"
  | "house-of-commons"
  | "downing-street"
  | "reichstag"
  | "government-buildings-dublin"
  | "federal-reserve"
  | "us-overview-mount-rushmore"
  | "changelog"
  | "national-diet"
  | "kantei"
  | "bank-of-japan"
  | "bank-of-england"
  | "ecb"
  | "peoples-bank-of-china"
  | "great-hall-of-the-people"
  | "zhongnanhai"
  | "banco-central-do-brasil"
  | "palacio-do-planalto"
  | "aso-rock"
  | "central-bank-of-nigeria"
  | "imf"
  | "imf-logo"
  | `commodity-${string}`;

export function cdnHero(slug: string): string {
  const ext = slug === "imf-logo" ? "png" : "webp";
  return cdnStatic("heroes", slug, ext);
}

export function cdnMisc(slug: string): string {
  return cdnStatic("misc", slug);
}

export function cdnSeal(countryId: string): string {
  return cdnStatic("seals", countryId.toLowerCase());
}

export function cdnCrisis(unsplashPhotoSlug: string): string {
  return cdnStatic("crises", unsplashPhotoSlug);
}

export function cdnPree(unsplashPhotoSlug: string): string {
  return cdnStatic("pree", unsplashPhotoSlug);
}

export function cdnNppPolitician(id: string): string {
  return cdnStatic("npp-politicians", id);
}

export function cdnNppAvatar(id: string): string {
  return cdnStatic("npp-avatars", id);
}

/**
 * Landing bento card images. Slugs: state-metrics, ballot-box,
 * legislative-combat, industrial-empires, global-markets, newsroom,
 * central-banks, world-1979. Published by
 * `scripts/upload-landing-images-to-r2.mjs` to `static/landing/<slug>.webp`.
 * Use with `unoptimized` on `next/image` (CDN host not in remotePatterns).
 */
export function cdnLanding(slug: string): string {
  return cdnStatic("landing", slug);
}

const CDN_MAPS_BASE = `${CDN_BASE}/static/maps`;

/** Regional GeoJSON files served from R2. Upload via `scripts/upload-geo-maps-to-r2.mjs`. */
export const CDN_GEO = {
  worldCountries: `${CDN_MAPS_BASE}/countries-110m.json`,
  usStates: `${CDN_MAPS_BASE}/us-states-10m.json`,
  brRegions: `${CDN_MAPS_BASE}/br-regions.json`,
  cnRegions: `${CDN_MAPS_BASE}/cn-regions.json`,
  cnRegions1991: `${CDN_MAPS_BASE}/cn-regions-1991.json`,
  deLaender: `${CDN_MAPS_BASE}/de-laender.json`,
  japanPrefectures: `${CDN_MAPS_BASE}/japan-prefectures.json`,
  britishIsles: `${CDN_MAPS_BASE}/british-isles-regions.json`,
  ukNuts1: `${CDN_MAPS_BASE}/uk-nuts1.json`,
  ieRegions: `${CDN_MAPS_BASE}/ie-regions.json`,
  scoRegions: `${CDN_MAPS_BASE}/sco-regions.json`,
  walRegions: `${CDN_MAPS_BASE}/wal-regions.json`,
  ngRegions: `${CDN_MAPS_BASE}/ng-regions.json`,
} as const;

/** @deprecated Use CDN_GEO.worldCountries */
export const CDN_WORLD_GEO_URL = CDN_GEO.worldCountries;

/** @deprecated Use cdnHero("actions") — kept for existing imports */
export { CDN_HERO_ACTIONS_URL } from "./staticCdnAssets";
