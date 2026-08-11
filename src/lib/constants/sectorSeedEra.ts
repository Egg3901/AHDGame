/**
 * Era-aware calibration for seed-time sector market sizing.
 *
 * `SECTOR_SEED_SCALE` (constants/corporations.ts) is a pure GDP MULTIPLE, so it
 * is already era-neutral: a state's market is `gdp × usdExchangeRate × SCALE ×
 * weight`, which keeps sector revenue a fixed share of the economy in any era.
 * The MINIMUM (`MIN_UNOWNED_SECTOR_REVENUE`, ₳1,000,000) is not — it is an
 * absolute ₳ amount calibrated against MODERN nominal GDP magnitudes.
 *
 * WHY THIS MODULE EXISTS: the 1953 world is denominated in 1953 dollars (the ₳
 * anchor tracks the US, whose 1953 national seed GDP is $387B vs $27,000B in
 * 2019 — ~70x smaller in nominal terms). A ₳1,000,000 floor that binds on ~1%
 * of modern (state, sector) buckets binds on nearly ALL of them at 1953
 * magnitudes: before this fix, 13 of 26 seeded entities had EVERY unowned
 * sector at exactly the floor — one single revenue value across the whole
 * country, zero regional or sectoral differentiation (the UK, a player-enabled
 * country, had all 204 of its sectors identical). The floor, not the economy,
 * was setting sector revenue for half the world.
 *
 * THE FIX mirrors `getGdpIndexedCostScale` (budget/costs.ts), which deflates
 * absolute per-capita law costs for pre-1991 economies so that cost/GDP stays
 * invariant instead of clamping modern-authored absolutes onto a 10-100x
 * smaller nominal economy. Here the same reasoning applies to a minimum: the
 * floor is deflated by the era's nominal-economy ratio so it stays the same
 * SHARE of the economy it was calibrated at, and differentiation comes from
 * the GDP-and-weight term again.
 *
 * KEYING: on the SEED PRESET (via `eraForPreset`), not the current in-game
 * year — unlike `constants/monetaryEra.ts`, whose anchors are per-turn runtime
 * values and therefore graduate as a world's clock advances. Sector seed
 * revenue is written ONCE at seed time from frozen seed data, so it keys on
 * the preset that produced it. A 1953 world that plays on to 1975 keeps the
 * sector markets it was seeded with; only its monetary anchors graduate.
 *
 * NO-OP GUARANTEE: only eras listed in {@link SECTOR_SEED_ERA_FLOORS} deviate.
 * Every other preset — including all modern presets (1991/1999/2007/2019/2023),
 * the 1979 era, aliases such as `empty` / `2019-no-parties`, unknown preset
 * strings, and callers that pass no preset at all — resolves the unchanged
 * modern constants. See `sectorSeedEra.test.ts`.
 *
 * 1979 IS DELIBERATELY NOT LISTED: its nominal economy (US $2,632B seed GDP)
 * is only ~10x below 2019 and its base `usdExchangeRate` values are already
 * 1979-calibrated, so it is left byte-identical here pending its own
 * measurement pass.
 */

import type { EraId } from "@/lib/seeds/presetSelector";
import { eraForPreset } from "@/lib/seeds/presetSelector";
import { SECTOR_SEED_SCALE } from "./corporations";

/**
 * Modern (2019-calibrated) minimum ₳ revenue for one unowned (state, sector)
 * bucket. Re-exported by `seedUnownedSectors` as `MIN_UNOWNED_SECTOR_REVENUE`.
 */
export const MODERN_MIN_UNOWNED_SECTOR_REVENUE = 1_000_000;

/**
 * US national seed GDP by era, from `getNationalBudgetSeedConfigsForPreset` in
 * `seeds/reference/budgets.ts` (this module cannot import that file — it would
 * drag the whole budget seed graph into `constants/`). The US is the yardstick
 * because the ₳ anchor trades ~1:1 with the dollar in every era, so the ratio
 * between two entries is the eras' nominal-money ratio.
 * Kept in sync by `sectorSeedEra.test.ts`.
 */
export const US_NATIONAL_SEED_GDP_BY_ERA: Partial<Record<EraId, number>> = {
  "1953": 387_000_000_000,
  "2019": 27_000_000_000_000,
};

/**
 * The era's nominal-money scale relative to 2019, from
 * {@link US_NATIONAL_SEED_GDP_BY_ERA}. 1953 ≈ 0.0143 ($387B / $27,000B); every
 * era without an entry (all modern presets, 1979/1991, aliases, no preset)
 * returns exactly 1, so this is a strict no-op outside the listed eras.
 *
 * Use it wherever an ABSOLUTE ₳ amount was calibrated on modern nominal GDP and
 * has to keep the same SHARE of a smaller nominal economy. Two consumers today:
 * the unowned-sector revenue floor below, and NPP corporations' default starting
 * capital (`spawnNppCorporation`, refs #3778 §3), which capitalized a 1953 NPP
 * corp at ₳2,000,000 — roughly 70x a whole 1953 regional sector market — so a
 * spawned NPP corp could buy its market outright on day one.
 */
export function getEraNominalScale(preset?: string): number {
  const modern = US_NATIONAL_SEED_GDP_BY_ERA["2019"];
  if (!preset || !modern) return 1;
  const eraGdp = US_NATIONAL_SEED_GDP_BY_ERA[eraForPreset(preset)];
  if (!eraGdp) return 1;
  return eraGdp / modern;
}

/**
 * UNIT-BASIS scale for the plants tier: how many capacity units the era's
 * money buys per modern-priced unit.
 *
 * Every ₳↔unit conversion in the plants stack (impliedOutputUnits, RPU,
 * capacityPricePerUnit, headroom, contract per-unit pricing) was calibrated on
 * the 2019 `COMMODITY_BASE_PRICES` table. In a 1953 world the ₳ figures being
 * converted are ~70x smaller, so with the modern table a "unit" stays a
 * modern-sized quantum and the whole world collapses into a handful of units:
 * markets of single-digit capacity, quantization dead zones, and per-unit
 * prices that dwarf era incomes.
 *
 * This scale is the reciprocal of {@link getEraNominalScale} (~70 for 1953,
 * exactly 1 for every modern preset, alias, unknown string and absent preset).
 * Multiplying unit counts by it — equivalently dividing per-unit ₳ figures by
 * it — re-expresses the unit in the era's own prices, so a 1953 state sector
 * holds a modern-comparable number of units and one unit earns era-scale
 * revenue. Both directions of every conversion MUST use the same scale or the
 * two legs of a stored (revenue, units) pair drift by the era ratio; that is
 * why the scale is resolved here once and threaded, never recomputed ad hoc.
 */
export function getEraUnitScale(preset?: string): number {
  const nominal = getEraNominalScale(preset);
  return nominal > 0 ? 1 / nominal : 1;
}

/**
 * Per-era override of the unowned-sector revenue floor, in ₳.
 *
 * 1953: 1,000,000 × ($387B ÷ $27,000B) ≈ 14,333 → 15,000 (rounded up to a
 * legible round number; the test pins it within 20% of the derived value).
 * At this floor the seeded 1953 world differentiates on GDP and sector weight
 * the way a modern world does, and the floor goes back to being what it was
 * designed to be — a guard against degenerate near-zero buckets in the
 * smallest regions, not the value of half the world's sectors.
 */
export const SECTOR_SEED_ERA_FLOORS: Partial<Record<EraId, number>> = {
  "1953": 15_000,
};

/**
 * Per-era override of the seed-time GDP multiple. Intentionally EMPTY: the
 * scale is a GDP multiple and therefore already era-neutral (see module doc).
 * The hook exists so a future era that genuinely needs a different market
 * DEPTH (not just a different money magnitude) has an obvious place to say so,
 * rather than reaching for the floor as a proxy.
 */
export const SECTOR_SEED_ERA_SCALES: Partial<Record<EraId, number>> = {};

/**
 * Minimum ₳ revenue for one unowned (state, sector) bucket under `preset`.
 * Returns {@link MODERN_MIN_UNOWNED_SECTOR_REVENUE} for every era without an
 * explicit entry, and for a missing/unknown preset.
 */
export function getMinUnownedSectorRevenue(preset?: string): number {
  if (!preset) return MODERN_MIN_UNOWNED_SECTOR_REVENUE;
  return SECTOR_SEED_ERA_FLOORS[eraForPreset(preset)] ?? MODERN_MIN_UNOWNED_SECTOR_REVENUE;
}

/**
 * Seed-time GDP multiple for `preset`. Returns the unchanged
 * {@link SECTOR_SEED_SCALE} for every era without an explicit entry.
 */
export function getSectorSeedScale(preset?: string): number {
  if (!preset) return SECTOR_SEED_SCALE;
  return SECTOR_SEED_ERA_SCALES[eraForPreset(preset)] ?? SECTOR_SEED_SCALE;
}

/**
 * Era-scaled baseline price for one commodity, in ₳.
 *
 * `COMMODITY_BASE_PRICES` is a single 2019-calibrated table (steel ₳800/ton,
 * energy ₳60/MWh). Seeding those into a 1953 world prices a mid-century economy
 * in modern money: the same ~70x nominal mismatch the unowned-sector floor had,
 * applied to every commodity market at once, so sector revenue, extraction
 * economics and trade all start on the wrong scale.
 *
 * Deliberately a UNIFORM deflation by {@link getEraNominalScale} rather than a
 * per-commodity historical table. Real relative prices did move — oil outran
 * the general price level by roughly 3x between 1953 and 2019 — but authoring
 * that per commodity would be inventing a specific history and baking it in.
 * A uniform scale moves the whole price LEVEL, which is what the era actually
 * needs, and leaves relative prices to the market. Gentle by construction.
 *
 * Same no-op guarantee and the same SEED-PRESET keying as the floor above: only
 * eras present in {@link US_NATIONAL_SEED_GDP_BY_ERA} deviate, and seed-time
 * values key on the preset that produced them rather than the live clock.
 */
export function getEraCommodityBasePrice(modernBasePrice: number, preset?: string): number {
  const scale = getEraNominalScale(preset);
  if (scale === 1) return modernBasePrice;
  // Never round a price to zero — the smallest markets still need a positive
  // unit price or every downstream ratio divides by nothing.
  return Math.max(0.01, modernBasePrice * scale);
}

/**
 * An absolute ₳ amount expressed in the era's own money.
 *
 * The generic form of the deflation the unowned-sector floor, commodity prices,
 * character starting cash and NPP corporate capital all use. Anywhere a flat
 * constant was calibrated on modern nominal magnitudes and has to keep the same
 * SHARE of a smaller nominal economy, put it through here rather than adding a
 * fourth scale.
 *
 * Same no-op guarantee as {@link getEraNominalScale}: eras without an entry —
 * every modern preset, alias, unknown string and absent preset — return the
 * amount unchanged.
 */
export function getEraNominalAmount(modernAmount: number, preset?: string): number {
  if (!Number.isFinite(modernAmount) || modernAmount <= 0) return modernAmount;
  const scale = getEraNominalScale(preset);
  if (scale === 1) return modernAmount;
  // Legible whole number, but a real amount must never deflate away entirely.
  return Math.max(1, Math.round(modernAmount * scale));
}

/**
 * Issued share count for a NEWLY MINTED corporation, in the era's own money.
 *
 * The share base and the treasury that backs it must deflate together, or the
 * per-share price collapses below `MIN_SHARE_PRICE` and floors. A 1953
 * founding seeds ~14,333 over a fixed 10,000,000 shares — a true price of
 * $0.0014 that floors at $0.01, opening the corporation at a ~$100,000 market
 * cap against a $14,333 treasury (~7x). Modern is exact by construction
 * (1,000,000 / 10,000,000 = the $0.10 default). Scaling the share base by the
 * same factor restores that identity in every era: market cap at founding
 * equals the treasury, and the opening price is $0.10 whatever the year.
 *
 * MINT SITES ONLY. Read paths that fall back to `CEO_INITIAL_SHARES` for
 * legacy documents (`corp.totalShares ?? CEO_INITIAL_SHARES`) must keep using
 * the raw modern constant — those rows were written with a 10,000,000 base,
 * and reinterpreting them at the era count would silently restate existing
 * cap tables.
 */
export function getEraFounderShares(modernShares: number, preset?: string): number {
  return getEraNominalAmount(modernShares, preset);
}

/**
 * Era-scaled corporation founding numbers, for the server route AND the
 * founding modal. Both must use this so the preview equals the charge.
 */
export function getEraFoundingBounds(
  preset: string | undefined,
  modern: { fee: number; baseline: number; min: number; max: number }
): { fee: number; baseline: number; min: number; max: number } {
  return {
    fee: getEraNominalAmount(modern.fee, preset),
    baseline: getEraNominalAmount(modern.baseline, preset),
    min: getEraNominalAmount(modern.min, preset),
    max: getEraNominalAmount(modern.max, preset),
  };
}
