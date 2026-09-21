import type { CountryEconomy } from "../contract";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";

/**
 * SCO's money.
 *
 * ⚠ GENERATED FROM `__snapshots__/sco.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-economy.ts SCO --force
 *
 * ⚠ THE EXCHANGE RATE IS NOT HERE, DELIBERATELY. Currency IDENTITY is this
 * country's fact and moved; a rate is a fact about a PAIR of countries in a
 * YEAR, and belongs beside the rates it must stay consistent with. Moving one
 * into a country folder would give it a value whose meaning only exists relative
 * to the table it left.
 *
 * ⚠ EVERY FIGURE BELOW IS IN LOCAL CURRENCY and is not comparable to another
 * country's. Do not reconcile one toward its neighbours.
 *
 * ⚠ NO MONETARY BASELINE FOR 1953, 1971, 1979, 1991: SCO has no entry in
 * those era tables and takes the base baseline. The key is ABSENT rather than
 * defaulted, because inventing one would turn a fallback into an authored value.
 *
 * ⚠ NO SECTOR WEIGHTS FOR 1953, 1979, for the same reason.
 */

const currencyCode = "GBP" as CurrencyCode;
const nationalPolicyStateId = "sco_national";
const legislationScope = "sco";
// No ECONOMIC_BASELINES row; the folder omits `economicBaseline` rather than defaulting it.
const baselineMonetary = {
  targetInflation: 2,
  neutralPrimeRate: 3,
};
const sectorWeightsBase = {
  real_estate: 14,
  financial: 13,
  manufacturing: 9,
  technology: 8,
  healthcare: 8,
  retail: 7,
  construction: 6,
  media_entertainment: 9,
  chemical_industries: 5,
  telecommunications: 4,
  logistics: 4,
  energy: 3,
  automobiles: 3,
  defense: 3,
  extraction: 3,
  agriculture: 1,
};
// No REP_ECON row; the folder omits `repEcon` rather than defaulting it.
// No COST_SCALE_ANCHORS row; the folder omits `costScaleAnchors` rather than defaulting it.
/**
 * ⚠ THE CAST IS LOAD-BEARING, for the same reason as the cabinet groups:
 * JSON.parse widens each sector name to `string`, and `CorporationType[]` is a
 * union array. Caught by typecheck alone.
 */
const strategicSectors: CorporationType[] = [];
const treasuryPsRate = {
  national: 60000,
  state: 30000,
};

/**
 * Whether this country's authored 1953 GDP figures are denominated in USD or in
 * local currency.
 *
 * ⚠ 1953 ONLY. `GDP_DENOMINATION_1953` is an era table and holds no other
 * preset, so this says nothing about any later era.
 */
/* No SCO_GDP_DENOMINATION_1953: the table lists only the countries the 1953
   world starts with, and SCO is not one of them. Later presets are uniformly
   local-currency by design, so there is nothing to denominate. */

export const SCO_ECONOMY: CountryEconomy = {
  currencyCode,
  nationalPolicyStateId,
  legislationScope,
  monetary: {
    baseline: baselineMonetary,
    byEra: {},
  },
  sectorWeights: {
    base: sectorWeightsBase,
    byEra: {
      "1991": {
        manufacturing: 16,
        financial: 11,
        retail: 9,
        construction: 8,
        real_estate: 10,
        healthcare: 6,
        chemical_industries: 6,
        energy: 5,
        defense: 5,
        automobiles: 4,
        extraction: 4,
        logistics: 3,
        telecommunications: 3,
        media_entertainment: 6,
        technology: 2,
        agriculture: 2,
      },
    },
  },
  strategicSectors,
  tax: {
    treasuryPsRate,
  },
};
