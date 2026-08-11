/**
 * The four country tiers the landing globe is allowed to draw.
 *
 * Product rule (owner, #globe-tiers): the globe shows and colors ONLY these
 * four tiers — nothing else. The previous globe painted three access outcomes
 * plus a near-black "not named by this era" dim that covered most of the map
 * and read as ocean; that dim is now an explicit tier (Background Nations) and
 * is drawn as visible land.
 *
 * Tiers are presentation only. Nothing here decides what is playable, resolves
 * access, or affects routing — see `resolveCountryAvailability` for that.
 */

/** Canonical tier ids. Order is the legend / z-order order. */
export type CountryTier = "player" | "economic" | "battleground" | "background";

/** Legend order, most-interactive first. */
export const TIER_ORDER: readonly CountryTier[] = [
  "player",
  "economic",
  "battleground",
  "background",
];

/** The owner's canonical names. Do not paraphrase these in UI copy. */
export const TIER_LABELS: Record<CountryTier, string> = {
  player: "Player Nations",
  economic: "Economic Powers",
  battleground: "Battleground Nations",
  background: "Background Nations",
};

/**
 * Exactly four fills: green / blue / orange / dark grey (owner spec).
 *
 * Background is deliberately the darkest and least saturated, but still clearly
 * land — a dark neutral grey that never reads as the blue ocean sphere beneath
 * it. Battleground is a true orange, kept clear of the amber/yellow the metric
 * heatmap uses so the two are never confused on the same globe.
 */
export const TIER_COLORS: Record<CountryTier, string> = {
  player: "rgba(74, 222, 128, 0.82)",
  economic: "rgba(56, 189, 248, 0.72)",
  battleground: "rgba(249, 115, 22, 0.75)",
  background: "rgba(71, 78, 90, 0.80)",
};

export const TIER_STROKES: Record<CountryTier, string> = {
  player: "rgba(187, 247, 208, 0.85)",
  economic: "rgba(186, 230, 253, 0.60)",
  battleground: "rgba(254, 215, 170, 0.55)",
  background: "rgba(120, 130, 146, 0.30)",
};

export const TIER_STROKE_WIDTHS: Record<CountryTier, number> = {
  player: 0.8,
  economic: 0.6,
  battleground: 0.6,
  background: 0.35,
};

/**
 * CRT wireframe mode (1953/1979 landing) paints every country the same near
 * black, which would erase the tiers entirely. Instead each tier gets its own
 * phosphor intensity over the black sphere — still four fills, still one color.
 */
const TIER_PHOSPHOR_ALPHA: Record<CountryTier, string> = {
  player: "96",
  economic: "5e",
  battleground: "36",
  background: "12",
};

/** Tier fill for CRT wireframe mode, derived from the era's phosphor color. */
export function tierWireframeFill(tier: CountryTier, phosphorColor: string): string {
  return `${phosphorColor}${TIER_PHOSPHOR_ALPHA[tier]}`;
}

/** The shape of an era/DB access record, narrowed to what tiering needs. */
export type TierCountryAccess = {
  enabledForPlayers?: boolean;
  economyPreview?: boolean;
};

/**
 * Resolve one country's tier.
 *
 * Precedence is deliberate: an era that names a country always wins over the
 * battleground roster, because a named country runs a real economy (India is an
 * Economic Power in 2019 even though it is a 1953 sphere-macro theatre).
 */
export function resolveCountryTier(
  access: TierCountryAccess | undefined | null,
  options?: { isEconomicPower?: boolean; isBattleground?: boolean }
): CountryTier {
  if (access?.enabledForPlayers) return "player";
  // Named by the era but not playable: full NPP autonomy, players can run and
  // split sectors there.
  if (access) return "economic";
  // Full-autonomy economies the landing era map does not name — this is what
  // carries the Warsaw Pact bloc, not just the West.
  if (options?.isEconomicPower) return "economic";
  if (options?.isBattleground) return "battleground";
  return "background";
}

/**
 * Background Nations are inert: static flavour so the world reads as a world.
 * They carry no hover handlers, no tooltip, and no click target.
 */
export function isTierInteractive(tier: CountryTier): boolean {
  return tier !== "background";
}

/**
 * Precomputed tier per map feature id, so rendering never has to re-derive a
 * country's tier per path per frame.
 *
 * Keys are Natural Earth feature ids (e.g. "840"), plus the synthetic
 * `bi:<countryId>` ids the landing globe uses for the split-Germany overlay.
 * A missing key means Background — the map has ~175 features and only a few
 * dozen are ever named, so enumerating the rest would be pure waste.
 */
export function buildTierLookup(
  isoToCountryId: Readonly<Record<string, string>>,
  access: Readonly<Record<string, TierCountryAccess | undefined>> | undefined,
  battlegroundFeatureIds: Iterable<string> = [],
  economicPowerFeatureIds: Iterable<string> = []
): Map<string, CountryTier> {
  const lookup = new Map<string, CountryTier>();

  // Written in precedence order, weakest first: an era that names a country
  // always outranks a roster entry.
  for (const featureId of battlegroundFeatureIds) {
    lookup.set(featureId, "battleground");
  }
  for (const featureId of economicPowerFeatureIds) {
    lookup.set(featureId, "economic");
  }

  if (!access) return lookup;

  for (const [featureId, countryId] of Object.entries(isoToCountryId)) {
    const countryAccess = access[countryId];
    if (!countryAccess) continue;
    lookup.set(featureId, resolveCountryTier(countryAccess));
  }

  // Region-overlay blobs (split Germany) are keyed by owner, not by ISO feature.
  for (const [countryId, countryAccess] of Object.entries(access)) {
    if (!countryAccess) continue;
    lookup.set(`bi:${countryId}`, resolveCountryTier(countryAccess));
  }

  return lookup;
}

/** Tier for a feature id, defaulting to Background. */
export function tierForFeature(
  lookup: ReadonlyMap<string, CountryTier> | undefined,
  featureId: string
): CountryTier {
  return lookup?.get(featureId) ?? "background";
}
