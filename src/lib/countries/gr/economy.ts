import type { CountryEconomy } from "../contract";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import type { LegalStructureId } from "@/lib/constants/legalStructures";

/**
 * GR's money.
 *
 * ⚠ GENERATED FROM `__snapshots__/gr.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-economy.ts GR --force
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
 * ⚠ NO MONETARY BASELINE FOR 1979, 1991: GR has no entry in
 * those era tables and takes the base baseline. The key is ABSENT rather than
 * defaulted, because inventing one would turn a fallback into an authored value.
 *
 * ⚠ NO SECTOR WEIGHTS FOR 1979, for the same reason.
 */

const currencyCode = "GRD" as CurrencyCode;
const nationalPolicyStateId = "gr_national";
const legislationScope = "gr";
// No ECONOMIC_BASELINES row; the folder omits `economicBaseline` rather than defaulting it.
const baselineMonetary = {
  targetInflation: 15,
  neutralPrimeRate: 16.5,
};
const sectorWeightsBase = {
  logistics: 14,
  real_estate: 12,
  retail: 10,
  entertainment: 10,
  agriculture: 8,
  construction: 7,
  financial: 7,
  manufacturing: 7,
  healthcare: 6,
  energy: 6,
  media: 4,
  technology: 3,
  extraction: 3,
  defense: 3,
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
  national: 70000,
  state: 35000,
};

/**
 * Whether this country's authored 1953 GDP figures are denominated in USD or in
 * local currency.
 *
 * ⚠ 1953 ONLY. `GDP_DENOMINATION_1953` is an era table and holds no other
 * preset, so this says nothing about any later era.
 */
export const GR_GDP_DENOMINATION_1953 = "local";

export const GR_ECONOMY: CountryEconomy = {
  currencyCode,
  nationalPolicyStateId,
  legislationScope,
  monetary: {
    baseline: baselineMonetary,
    byEra: {
      "1953": {
        targetInflation: 3,
        neutralPrimeRate: 6,
        trendGdpGrowth: 6.5,
      },
      "1971": {
        targetInflation: 10,
        neutralPrimeRate: 10,
        trendGdpGrowth: 4,
      },
    },
  },
  sectorWeights: {
    base: sectorWeightsBase,
    byEra: {
      "1953": {
        agriculture: 38,
        logistics: 12,
        construction: 10,
        manufacturing: 10,
        retail: 8,
        energy: 6,
        extraction: 5,
        financial: 4,
        real_estate: 4,
        defense: 3,
      },
      "1991": {
        logistics: 13,
        agriculture: 12,
        retail: 10,
        manufacturing: 10,
        real_estate: 10,
        construction: 8,
        entertainment: 8,
        financial: 6,
        energy: 6,
        healthcare: 5,
        media: 4,
        extraction: 4,
        defense: 4,
      },
    },
  },
  strategicSectors,
  tax: {
    treasuryPsRate,
  },
  sovereignCorpLegalStructure: "generic_corp" as LegalStructureId,
  gdpDenomination1953: GR_GDP_DENOMINATION_1953,
};
