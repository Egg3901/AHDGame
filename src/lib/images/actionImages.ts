/**
 * Era- and country-aware resolver for the action-card art on `/actions`.
 *
 * The original set was a flat `actions/<slug>.webp` map of modern stock and
 * 2000s-2020s press photos — jarring in a 1953 world. Art is now filed by era
 * and, where a genuinely era-correct national photo exists, by country:
 *
 *   static/actions/<era>/<country>/<slug>.webp   country-specific
 *   static/actions/<era>/<slug>.webp             era-generic
 *   static/actions/<slug>.webp                   legacy (pre-era) fallback
 *
 * Resolution never probes the network: `ERA_COUNTRY_SLUGS` lists exactly which
 * (era, country, slug) triples were uploaded, so a miss falls back to the
 * era-generic file rather than 404ing. Adding art therefore means uploading the
 * WebP *and* listing the slug here — see `scripts/fetch-action-images.mjs`.
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
 * Eras that have a complete generic set uploaded under `actions/<era>/`.
 *
 * "Complete" is load-bearing: once an era is listed here, EVERY slug resolves to
 * `actions/<era>/<slug>.webp` with no further fallback, so a missing file 404s
 * rather than degrading. `actionImages.test.ts` enforces the invariant against
 * `scripts/action-image-sources.json`.
 */
const ERAS_WITH_GENERIC_SET = new Set(["1953", "1979"]);

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

export interface ActionImageContext {
  /** Era id from `eraForPreset(preset)` — e.g. "1953". Undefined until flags load. */
  era?: string | null;
  /** Player's country id — e.g. "US". Undefined for country-agnostic surfaces. */
  countryId?: string | null;
}

/**
 * CDN URL for one action image. Falls back era-generic → legacy so a partially
 * uploaded era can never render a broken `<img>`.
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
      return `${CDN_ACTIONS_BASE}/${era}/${slug}.webp`;
    }
  }

  return `${CDN_ACTIONS_BASE}/${slug}.webp`;
}

/** Eras with a complete generic set, for tests and tooling. */
export function erasWithGenericSet(): string[] {
  return [...ERAS_WITH_GENERIC_SET];
}

/** Countries with at least one national image in this era, for tests and tooling. */
export function countriesWithArt(era: string): string[] {
  return Object.keys(ERA_COUNTRY_SLUGS[era] ?? {});
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
