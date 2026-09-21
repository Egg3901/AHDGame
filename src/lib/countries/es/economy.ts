import type { CountryEconomy } from "../contract";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import type { LegalStructureId } from "@/lib/constants/legalStructures";

/**
 * ES's money.
 *
 * ⚠ GENERATED FROM `__snapshots__/es.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-economy.ts ES --force
 *
 * ⚠ THE EXCHANGE RATE IS NOT HERE, DELIBERATELY. Currency IDENTITY is this
 * country's fact and moved; a rate is a fact about a PAIR of countries in a
 * YEAR, and belongs beside the rates it must stay consistent with. Moving one
 * into a country folder would give it a value whose meaning only exists relative
 * to the table it left.
 *
 * ⚠ EVERY FIGURE BELOW IS IN LOCAL CURRENCY and is not comparable to another
 * country's. Do not reconcile one toward its neighbours.
 */

const currencyCode = "ESP" as CurrencyCode;
const nationalPolicyStateId = "es_national";
const legislationScope = "es";
// No ECONOMIC_BASELINES row; the folder omits `economicBaseline` rather than defaulting it.
const baselineMonetary = {
  targetInflation: 16,
  neutralPrimeRate: 14,
};
const sectorWeightsBase = {
  manufacturing: 14,
  real_estate: 12,
  retail: 9,
  agriculture: 9,
  media_entertainment: 9,
  automobiles: 7,
  construction: 7,
  financial: 6,
  healthcare: 6,
  energy: 6,
  chemical_industries: 4,
  logistics: 4,
  defense: 2,
  technology: 1,
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
export const ES_GDP_DENOMINATION_1953 = "local";

export const ES_ECONOMY: CountryEconomy = {
  currencyCode,
  nationalPolicyStateId,
  legislationScope,
  monetary: {
    baseline: baselineMonetary,
    byEra: {
      "1953": {
        targetInflation: 4,
        neutralPrimeRate: 5,
        trendGdpGrowth: 4.5,
      },
      "1971": {
        targetInflation: 9,
        neutralPrimeRate: 9,
        trendGdpGrowth: 4,
      },
      "1979": {
        targetInflation: 16,
        neutralPrimeRate: 14,
        trendGdpGrowth: 2,
      },
      "1991": {
        targetInflation: 5.5,
        neutralPrimeRate: 9,
        trendGdpGrowth: 2.5,
      },
    },
  },
  sectorWeights: {
    base: sectorWeightsBase,
    byEra: {
      "1953": {
        agriculture: 25,
        manufacturing: 18,
        construction: 10,
        energy: 10,
        extraction: 6,
        logistics: 4,
        financial: 4,
        retail: 4,
        real_estate: 3,
        defense: 3,
        telecommunications: 2,
        media_entertainment: 3,
        healthcare: 2,
        automobiles: 1,
        chemical_industries: 1,
        technology: 0,
      },
      "1979": {
        manufacturing: 18,
        agriculture: 10,
        retail: 9,
        construction: 8,
        energy: 7,
        real_estate: 7,
        automobiles: 5,
        chemical_industries: 5,
        media_entertainment: 10,
        financial: 3,
        healthcare: 3,
        defense: 3,
        extraction: 4,
        logistics: 4,
        telecommunications: 2,
        technology: 1,
      },
      "1991": {
        manufacturing: 14,
        real_estate: 12,
        retail: 9,
        agriculture: 9,
        media_entertainment: 9,
        automobiles: 7,
        construction: 7,
        financial: 6,
        healthcare: 6,
        energy: 6,
        chemical_industries: 4,
        logistics: 4,
        defense: 2,
        technology: 1,
      },
    },
  },
  strategicSectors,
  tax: {
    treasuryPsRate,
  },
  sovereignCorpLegalStructure: "generic_corp" as LegalStructureId,
  m2ToGdp1953: 0.4,
  gdpDenomination1953: ES_GDP_DENOMINATION_1953,
};
