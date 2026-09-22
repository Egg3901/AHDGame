/**
 * Between-era campaign price level (issue #2119).
 *
 * PORTABLE RULES (see `rules/currency.ts`): plain data in, plain data out. No
 * database, clock, randomness, env, network, or async — the caller supplies the
 * world preset / era and this module resolves the scalar.
 *
 * WHY THIS EXISTS. #798 gave every (country, era) its own GDP-per-capita
 * baseline (`gdpBaseline.ts`), so `gdpPerCapita / baseline` resolves ~1.0 for an
 * average region WITHIN every era. That fixed regional differentiation but left
 * a BETWEEN-era distortion: a 1953 world still charged MODERN nominal dollar
 * costs (`CAMPAIGN_BASE_FUND_COST` $20k, `ADVERTISE_BASE_FUND_COST` $100k,
 * `BUILD_DONOR_BASE_FUND` $3k + $1.5k/level in `actions/rules.ts`) and paid
 * modern nominal income (`FUND_GENERATION_RATES` $5k-$40k, `OFFICE_FUND_BONUS`,
 * and the `calculateFundraisingAmount` $50k base) even though its nominal
 * economy is a small fraction of the modern one. This table is the missing
 * symmetric deflator: it scales BOTH action fund costs and campaign income so a
 * 1953 dollar buys 1953 amounts of both.
 *
 * HOW THE NUMBERS ARE DERIVED. With no dedicated US price index wired into the
 * seed set, the price level is approximated from the US row of the per-era
 * GDP-per-capita baseline already in `gdpBaseline.ts` (in USD-anchored modern
 * millions):
 *
 *     era price level ≈ US nominal GDP/capita(era) / US nominal GDP/capita(2019)
 *
 * Nominal GDP per capita tracks the general price level plus real growth; using
 * the ratio is admittedly an upper bound on pure inflation, but it is
 * consistent, available for every era, and mirrors the denominators the income
 * and cost math already use — so a 1953 world's costs and income move together
 * instead of one side staying modern. Values are rounded to 5 decimals.
 * `priceLevel.test.ts` recomputes every cell from `getGdpBaselineTable().US` and
 * fails if this table drifts from the baseline (edit seeds → recalibrate here).
 *
 * US baseline row (issue #798, USD-anchored millions) and the ratio:
 *   1953  2,557 / 69,618 = 0.036729
 *   1979 11,618 / 69,618 = 0.166882
 *   1991 24,929 / 69,618 = 0.358083
 *   1999 34,605 / 69,618 = 0.497070
 *   2007 45,683 / 69,618 = 0.656195
 *   2019 69,618 / 69,618 = 1.000000   ← modern baseline, the anchor
 *   2023 80,058 / 69,618 = 1.149961
 *   2027 89,514 / 69,618 = 1.285788
 *
 * FAIL-SAFE. Any unknown preset/era (or none) resolves the modern value 1, so a
 * caller that cannot describe its world — or a caller passing nothing at all —
 * is byte-identical to pre-#2119 behavior. This is the same posture as the
 * `DEFAULT_SEED_PRESET` fallback in `gdpBaseline.ts`.
 *
 * ⚠️ FEATURE-GATED. These values must only reach the money math when
 * `gameConfig.campaignEraPriceLevelEnabled` is true. The gate is resolved at the
 * SHELL boundary (execute route / turn phase, which already read
 * `gameState.preset`) via {@link resolveCampaignPriceLevel}; the pure cost and
 * income formulas take the resolved scalar and never read the flag themselves.
 */

import type { EraId } from "@/lib/seeds/presetSelector";
import { eraForPreset } from "@/lib/seeds/presetSelector";

/** Price level of the modern baseline era (2019): the identity scalar. */
export const MODERN_PRICE_LEVEL = 1;

/**
 * Era → price level relative to the modern (2019 === 1.0) US nominal
 * GDP-per-capita baseline. See the module doc for the derivation. Values below
 * 1 deflate a historical era; values above 1 inflate an era whose nominal
 * economy exceeds 2019 (2023/2027).
 */
export const ERA_PRICE_LEVEL: Record<EraId, number> = {
  "1953": 0.03673,
  "1979": 0.16688,
  "1991": 0.35808,
  "1999": 0.49707,
  "2007": 0.6562,
  "2019": MODERN_PRICE_LEVEL,
  "2023": 1.14996,
  "2027": 1.28579,
};

/**
 * Resolve the price level for an era or a world preset.
 *
 * Accepts either an `EraId` ("1953") or a reset preset id ("1953-default",
 * "empty", "2019-no-parties"). Unknown presets, the empty string and
 * null/undefined all resolve the modern value 1 (fail-safe = today's behavior),
 * because `eraForPreset` already folds every unrecognised preset onto the 2019
 * era.
 */
export function eraPriceLevelFor(presetOrEra?: string | null): number {
  if (!presetOrEra) return MODERN_PRICE_LEVEL;
  // Own-property check so an Object.prototype key ("constructor", "__proto__")
  // cannot masquerade as an authored era; those fall through to `eraForPreset`,
  // which maps unknown ids onto the modern era rather than returning a value.
  const era: EraId = Object.hasOwn(ERA_PRICE_LEVEL, presetOrEra)
    ? (presetOrEra as EraId)
    : eraForPreset(presetOrEra);
  return ERA_PRICE_LEVEL[era] ?? MODERN_PRICE_LEVEL;
}

/**
 * Resolve the price-level scalar to hand the money math, applying the feature
 * gate at the SHELL boundary.
 *
 * The execute route / turn phase reads `gameConfig.campaignEraPriceLevelEnabled`
 * and the world's `gameState.preset`, then calls this once and threads the
 * returned scalar into the pure cost/income functions. When the flag is absent
 * or false the scalar is exactly {@link MODERN_PRICE_LEVEL} (1), so every formula
 * reduces to its pre-#2119 arithmetic — the byte-identical guarantee.
 */
export function resolveCampaignPriceLevel(
  enabled: boolean | null | undefined,
  presetOrEra?: string | null
): number {
  if (enabled !== true) return MODERN_PRICE_LEVEL;
  return eraPriceLevelFor(presetOrEra);
}
