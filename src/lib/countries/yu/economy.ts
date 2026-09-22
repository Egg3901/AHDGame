import type { CountryEconomy } from "../contract";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import type { LegalStructureId } from "@/lib/constants/legalStructures";

/**
 * YU's money.
 *
 * ⚠ GENERATED FROM `__snapshots__/yu.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-economy.ts YU --force
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
 * ⚠ NO MONETARY BASELINE FOR 1971, 1979, 1991: YU has no entry in
 * those era tables and takes the base baseline. The key is ABSENT rather than
 * defaulted, because inventing one would turn a fallback into an authored value.
 */

const currencyCode = "YUD" as CurrencyCode;
const nationalPolicyStateId = "yu_national";
const legislationScope = "yu";
// No ECONOMIC_BASELINES row; the folder omits `economicBaseline` rather than defaulting it.
const baselineMonetary = {
  targetInflation: 15,
  neutralPrimeRate: 12,
};
const sectorWeightsBase = {
  manufacturing: 16,
  agriculture: 12,
  retail: 10,
  construction: 9,
  logistics: 7,
  entertainment: 6,
  real_estate: 6,
  healthcare: 6,
  financial: 4,
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
  national: 50000,
  state: 25000,
};

/**
 * Whether this country's authored 1953 GDP figures are denominated in USD or in
 * local currency.
 *
 * ⚠ 1953 ONLY. `GDP_DENOMINATION_1953` is an era table and holds no other
 * preset, so this says nothing about any later era.
 */
export const YU_GDP_DENOMINATION_1953 = "local";

export const YU_ECONOMY: CountryEconomy = {
  currencyCode,
  nationalPolicyStateId,
  legislationScope,
  monetary: {
    baseline: baselineMonetary,
    byEra: {
      "1953": {
        targetInflation: 5,
        neutralPrimeRate: 5,
        trendGdpGrowth: 5,
      },
    },
  },
  sectorWeights: {
    base: sectorWeightsBase,
    byEra: {
      "1953": {
        agriculture: 25,
        manufacturing: 20,
        defense: 12,
        construction: 8,
        retail: 5,
        extraction: 5,
        energy: 5,
        chemical_industries: 4,
        logistics: 4,
        healthcare: 3,
        financial: 2,
        entertainment: 2,
        media: 1,
        real_estate: 1,
        telecommunications: 1,
        automobiles: 1,
        technology: 0,
      },
      "1979": {
        manufacturing: 22,
        agriculture: 14,
        construction: 9,
        energy: 7,
        extraction: 7,
        chemical_industries: 7,
        defense: 8,
        logistics: 5,
        retail: 5,
        healthcare: 4,
        entertainment: 5,
        financial: 3,
        automobiles: 2,
        telecommunications: 1,
        media: 1,
        real_estate: 0,
        technology: 0,
      },
      "1991": {
        manufacturing: 16,
        agriculture: 12,
        retail: 10,
        construction: 9,
        logistics: 7,
        entertainment: 6,
        real_estate: 6,
        healthcare: 6,
        financial: 4,
      },
    },
  },
  strategicSectors,
  tax: {
    treasuryPsRate,
  },
  sovereignCorpLegalStructure: "generic_corp" as LegalStructureId,
  gdpDenomination1953: YU_GDP_DENOMINATION_1953,
};
