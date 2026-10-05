/**
 * Era- and country-aware resolver for the action-card art on `/actions`.
 *
 * The original set was a flat `actions/<slug>.webp` map of modern stock and
 * 2000s-2020s press photos (a 2024 billboard, a 2019 candidate portrait): jarring
 * in a 1953 world and flatly wrong in 1991. Art is now filed by era and, where a
 * genuinely era-correct national photo exists, by country:
 *
 *   static/actions/<era>/<country>/<slug>.webp   country-specific
 *   static/actions/<era>/<slug>.webp             era-generic (every era has a full set)
 *   static/actions/neutral/<slug>.webp           era-neutral set, people-free where it can be
 *
 * The flat legacy `actions/<slug>.webp` files are no longer referenced: a
 * missing or unknown era resolves to the neutral set, never to another era's
 * photographs.
 *
 * Resolution never probes the network: `ERA_COUNTRY_SLUGS` lists exactly which
 * (era, country, slug) triples were uploaded, so a miss falls back to the
 * era-generic file rather than 404ing. Adding art therefore means uploading the
 * WebP *and* listing the slug here. Sources and licences are recorded in
 * `scripts/action-image-sources.json`. Replaced art is served under a versioned
 * name (see `ACTION_ART_REVISIONS`) so the CDN cache never shows the old image.
 */

const CDN_ACTIONS_BASE = "https://cdn.ahousedividedgame.com/static/actions";

export const ACTION_IMAGE_SLUGS = [
  "campaign",
  "advertise",
  "fundraise",
  "buildDonorBase",
  "convertCash",
  "poll",
  "pollLarge",
  "canvass",
  "flipflop",
  "debatePrep",
  "hero",
] as const;

export type ActionImageSlug = (typeof ACTION_IMAGE_SLUGS)[number];

/**
 * Eras that have a complete generic set uploaded under `actions/<era>/`. Every
 * era the game seeds (`EraId`) is listed.
 *
 * "Complete" is load-bearing: once an era is listed here, EVERY slug resolves to
 * `actions/<era>/<slug>.webp` with no further fallback, so a missing file 404s
 * rather than degrading. `actionImages.test.ts` enforces the invariant against
 * `scripts/action-image-sources.json`.
 */
const ERAS_WITH_GENERIC_SET = new Set([
  "1953",
  "1979",
  "1991",
  "1999",
  "2007",
  "2019",
  "2023",
  "2027",
]);

/** Folder of the era-neutral set, used when the era is unknown or has no set. */
export const NEUTRAL_ART_FOLDER = "neutral";

/**
 * Country-specific art, by era. Only slugs listed here exist on the CDN under
 * `actions/<era>/<country>/`; everything else falls through to era-generic.
 */
const ERA_COUNTRY_SLUGS: Record<string, Record<string, readonly ActionImageSlug[]>> = {
  "1953": {
    US: ["campaign", "advertise", "fundraise", "buildDonorBase", "convertCash", "canvass", "hero"],
    UK: ["campaign", "advertise", "canvass", "hero"],
    FR: ["advertise"],
    DD: ["campaign", "advertise", "canvass", "hero"],
  },
  "1979": {
    US: ["campaign", "fundraise", "canvass", "flipflop", "hero"],
    UK: ["campaign"],
    RU: ["campaign", "convertCash", "hero"],
    DD: ["campaign", "convertCash", "hero"],
  },
};

/**
 * Replaced art. The CDN serves action art with `immutable` year-long caching,
 * so a replaced image is uploaded under a versioned name (`<slug>-v<n>.webp`)
 * instead of overwriting the old object, and the key here points the resolver
 * at it. Keys are `<era>/<slug>` (era-generic) or `neutral/<slug>`. Mirrors the
 * `revision` field in `scripts/action-image-sources.json`; a test keeps them equal.
 */
export const ACTION_ART_REVISIONS: Readonly<Record<string, number>> = {
  "1999/fundraise": 2,
  "1999/poll": 2,
  "1999/pollLarge": 2,
  "2007/debatePrep": 2,
  "2019/campaign": 2,
  "2019/canvass": 2,
  "2019/debatePrep": 2,
  "2019/flipflop": 2,
  "2019/fundraise": 2,
  "2023/advertise": 2,
  "2023/buildDonorBase": 2,
  "2023/campaign": 2,
  "2023/canvass": 2,
  "2023/fundraise": 2,
  "2027/canvass": 2,
  "2027/flipflop": 2,
  "neutral/advertise": 2,
  "neutral/buildDonorBase": 2,
  "neutral/campaign": 2,
  "neutral/debatePrep": 2,
  "neutral/flipflop": 2,
  "neutral/fundraise": 2,
};

/** CDN URL of one generic or neutral art file, honouring its revision. */
function artUrl(folder: string, slug: ActionImageSlug): string {
  const rev = ACTION_ART_REVISIONS[`${folder}/${slug}`];
  return `${CDN_ACTIONS_BASE}/${folder}/${slug}${rev ? `-v${rev}` : ""}.webp`;
}

export interface ActionImageContext {
  /** Era id from `eraForPreset(preset)` — e.g. "1953". Undefined until flags load. */
  era?: string | null;
  /** Player's country id — e.g. "US". Undefined for country-agnostic surfaces. */
  countryId?: string | null;
}

/**
 * CDN URL for one action image. Falls back national → era-generic → era-neutral.
 * It never falls back to a different era's art, so a world cannot be shown
 * another decade's people.
 */
export function getActionImage(slug: ActionImageSlug, ctx: ActionImageContext = {}): string {
  const era = ctx.era ?? null;
  const countryId = ctx.countryId ?? null;

  if (era) {
    const countrySlugs = countryId ? ERA_COUNTRY_SLUGS[era]?.[countryId] : undefined;
    if (countrySlugs?.includes(slug)) {
      return `${CDN_ACTIONS_BASE}/${era}/${countryId}/${slug}.webp`;
    }
    if (ERAS_WITH_GENERIC_SET.has(era)) {
      return artUrl(era, slug);
    }
  }

  return artUrl(NEUTRAL_ART_FOLDER, slug);
}

/** Eras with a complete generic set, for tests and tooling. */
export function erasWithGenericSet(): string[] {
  return [...ERAS_WITH_GENERIC_SET];
}

/** Countries with at least one national image in this era, for tests and tooling. */
export function countriesWithArt(era: string): string[] {
  return Object.keys(ERA_COUNTRY_SLUGS[era] ?? {});
}

/**
 * Era → country → the slugs uploaded under `actions/<era>/<country>/`. The
 * public CDN catalog publishes this so a client can construct a national art
 * URL that exists rather than falling back through a 404.
 */
export function countryArtSlugs(): Record<string, Record<string, readonly ActionImageSlug[]>> {
  return ERA_COUNTRY_SLUGS;
}

/** Eras with at least one country-specific image, for tests and tooling. */
export function erasWithCountryArt(): string[] {
  return Object.keys(ERA_COUNTRY_SLUGS);
}

/** True when this (era, country, slug) has bespoke national art, not the generic. */
export function hasCountryActionImage(
  slug: ActionImageSlug,
  era: string | null | undefined,
  countryId: string | null | undefined
): boolean {
  if (!era || !countryId) return false;
  return ERA_COUNTRY_SLUGS[era]?.[countryId]?.includes(slug) ?? false;
}
