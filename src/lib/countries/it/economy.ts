import type { CountryEconomy } from "../contract";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import type { LegalStructureId } from "@/lib/constants/legalStructures";

/**
 * IT's money.
 *
 * ⚠ GENERATED FROM `__snapshots__/it.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-economy.ts IT --force
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

const currencyCode = "ITL" as CurrencyCode;
const nationalPolicyStateId = "it_national";
const legislationScope = "it";
// No ECONOMIC_BASELINES row; the folder omits `economicBaseline` rather than defaulting it.
const baselineMonetary = {
  targetInflation: 15,
  neutralPrimeRate: 12,
};
const sectorWeightsBase = {
  manufacturing: 18,
  real_estate: 11,
  retail: 9,
  automobiles: 8,
  agriculture: 8,
  media_entertainment: 8,
  financial: 6,
  construction: 6,
  energy: 6,
  healthcare: 6,
  chemical_industries: 5,
  logistics: 4,
  defense: 3,
  technology: 2,
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
export const IT_GDP_DENOMINATION_1953 = "usd";

export const IT_ECONOMY: CountryEconomy = {
  currencyCode,
  nationalPolicyStateId,
  legislationScope,
  monetary: {
    baseline: baselineMonetary,
    byEra: {
      "1953": {
        targetInflation: 2.5,
        neutralPrimeRate: 4,
        trendGdpGrowth: 6,
      },
      "1971": {
        targetInflation: 9,
        neutralPrimeRate: 10,
        trendGdpGrowth: 3,
      },
      "1979": {
        targetInflation: 15,
        neutralPrimeRate: 12,
        trendGdpGrowth: 3.5,
      },
      "1991": {
        targetInflation: 5.5,
        neutralPrimeRate: 9,
        trendGdpGrowth: 1.5,
      },
    },
  },
  sectorWeights: {
    base: sectorWeightsBase,
    byEra: {
      "1953": {
        manufacturing: 24,
        agriculture: 20,
        construction: 12,
        energy: 7,
        automobiles: 6,
        real_estate: 5,
        retail: 5,
        financial: 5,
        logistics: 4,
        chemical_industries: 4,
        defense: 2,
        healthcare: 2,
        telecommunications: 2,
        media_entertainment: 3,
        extraction: 1,
        technology: 0,
      },
      "1979": {
        manufacturing: 22,
        retail: 10,
        agriculture: 6,
        construction: 8,
        chemical_industries: 5,
        energy: 6,
        automobiles: 6,
        real_estate: 7,
        healthcare: 4,
        defense: 3,
        financial: 3,
        logistics: 4,
        telecommunications: 2,
        extraction: 2,
        technology: 1,
        media_entertainment: 11,
      },
      "1991": {
        manufacturing: 18,
        real_estate: 11,
        retail: 9,
        automobiles: 8,
        agriculture: 8,
        media_entertainment: 8,
        financial: 6,
        construction: 6,
        energy: 6,
        healthcare: 6,
        chemical_industries: 5,
        logistics: 4,
        defense: 3,
        technology: 2,
      },
    },
  },
  strategicSectors,
  tax: {
    treasuryPsRate,
  },
  sovereignCorpLegalStructure: "generic_corp" as LegalStructureId,
  m2ToGdp1953: 0.42,
  gdpDenomination1953: IT_GDP_DENOMINATION_1953,
};
