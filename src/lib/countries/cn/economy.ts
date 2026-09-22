import type { CountryEconomy } from "../contract";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import type { LegalStructureId } from "@/lib/constants/legalStructures";

/**
 * CN's money.
 *
 * ⚠ GENERATED FROM `__snapshots__/cn.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-economy.ts CN --force
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
 * ⚠ NO MONETARY BASELINE FOR 1953, 1979: CN has no entry in
 * those era tables and takes the base baseline. The key is ABSENT rather than
 * defaulted, because inventing one would turn a fallback into an authored value.
 */

const currencyCode = "CNY" as CurrencyCode;
const nationalPolicyStateId = "cn_national";
const legislationScope = "cn";
const economicBaseline = {
  gdpGrowth: 5,
  tradeGrowth: 4,
};
const baselineMonetary = {
  targetInflation: 2,
  neutralPrimeRate: 4,
};
const sectorWeightsBase = {
  manufacturing: 18,
  real_estate: 13,
  construction: 9,
  technology: 9,
  financial: 8,
  energy: 7,
  chemical_industries: 6,
  retail: 6,
  logistics: 5,
  healthcare: 4,
  extraction: 4,
  agriculture: 3,
  telecommunications: 3,
  automobiles: 2,
  media_entertainment: 2,
  defense: 1,
};
const repEcon = {
  gdp: 126000000000000,
  population: 1412000000,
};
const costScaleAnchors = {
  gdpLow: 2178000000000,
  popLow: 1158000000,
  scaleLow: 0.02,
  gdpHigh: 126000000000000,
  popHigh: 1412000000,
  scaleHigh: 1,
};
/**
 * ⚠ THE CAST IS LOAD-BEARING, for the same reason as the cabinet groups:
 * JSON.parse widens each sector name to `string`, and `CorporationType[]` is a
 * union array. Caught by typecheck alone.
 */
const strategicSectors = ["telecommunications", "technology", "energy"] as CorporationType[];
const treasuryPsRate = {
  national: 500000,
  state: 250000,
};

/**
 * Whether this country's authored 1953 GDP figures are denominated in USD or in
 * local currency.
 *
 * ⚠ 1953 ONLY. `GDP_DENOMINATION_1953` is an era table and holds no other
 * preset, so this says nothing about any later era.
 */
export const CN_GDP_DENOMINATION_1953 = "usd";

export const CN_ECONOMY: CountryEconomy = {
  currencyCode,
  nationalPolicyStateId,
  legislationScope,
  economicBaseline,
  monetary: {
    baseline: baselineMonetary,
    byEra: {
      "1971": {
        targetInflation: 2,
        neutralPrimeRate: 4,
        trendGdpGrowth: 5,
      },
      "1991": {
        targetInflation: 5,
        neutralPrimeRate: 7,
      },
    },
  },
  sectorWeights: {
    base: sectorWeightsBase,
    byEra: {
      "1953": {
        agriculture: 35,
        manufacturing: 20,
        construction: 12,
        energy: 10,
        extraction: 6,
        defense: 6,
        logistics: 4,
        chemical_industries: 2,
        financial: 2,
        retail: 1,
        real_estate: 1,
        healthcare: 1,
        telecommunications: 0,
        media_entertainment: 0,
        automobiles: 0,
        technology: 0,
      },
      "1979": {
        agriculture: 30,
        manufacturing: 22,
        extraction: 10,
        energy: 8,
        construction: 7,
        defense: 8,
        chemical_industries: 5,
        logistics: 4,
        retail: 3,
        healthcare: 2,
        telecommunications: 1,
        technology: 0,
        financial: 0,
        real_estate: 0,
        automobiles: 0,
        media_entertainment: 0,
      },
      "1991": {
        manufacturing: 28,
        agriculture: 24,
        construction: 7,
        extraction: 8,
        energy: 6,
        retail: 5,
        chemical_industries: 5,
        logistics: 4,
        financial: 3,
        real_estate: 3,
        healthcare: 3,
        defense: 2,
        automobiles: 1,
        telecommunications: 1,
        technology: 1,
        media_entertainment: 2,
      },
    },
  },
  strategicSectors,
  repEcon,
  costScaleAnchors,
  tax: {
    neutralStateSalesTax: 4,

    treasuryPsRate,
  },
  sovereignCorpLegalStructure: "cn_gufen" as LegalStructureId,
  m2ToGdp1953: 0.32,
  gdpDenomination1953: CN_GDP_DENOMINATION_1953,
};
