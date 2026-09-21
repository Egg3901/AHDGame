import type { CountryEconomy } from "../contract";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import type { LegalStructureId } from "@/lib/constants/legalStructures";

/**
 * IE's money.
 *
 * ⚠ GENERATED FROM `__snapshots__/ie.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-economy.ts IE --force
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
 * ⚠ NO MONETARY BASELINE FOR 1953: IE has no entry in
 * those era tables and takes the base baseline. The key is ABSENT rather than
 * defaulted, because inventing one would turn a fallback into an authored value.
 */

const currencyCode = "IEP" as CurrencyCode;
const nationalPolicyStateId = "ie_national";
const legislationScope = "ie";
const economicBaseline = {
  gdpGrowth: 3.5,
  tradeGrowth: 2.5,
};
const baselineMonetary = {
  targetInflation: 2,
  neutralPrimeRate: 3,
};
const sectorWeightsBase = {
  technology: 19,
  financial: 15,
  chemical_industries: 13,
  real_estate: 9,
  healthcare: 8,
  retail: 6,
  construction: 6,
  logistics: 5,
  agriculture: 4,
  media_entertainment: 5,
  telecommunications: 3,
  manufacturing: 3,
  energy: 1,
  defense: 1,
  automobiles: 1,
  extraction: 1,
};
const repEcon = {
  gdp: 500000000000,
  population: 5100000,
};
const costScaleAnchors = {
  gdpLow: 24000000000,
  popLow: 3525000,
  scaleLow: 0.2,
  gdpHigh: 500000000000,
  popHigh: 5100000,
  scaleHigh: 1,
};
/**
 * ⚠ THE CAST IS LOAD-BEARING, for the same reason as the cabinet groups:
 * JSON.parse widens each sector name to `string`, and `CorporationType[]` is a
 * union array. Caught by typecheck alone.
 */
const strategicSectors = ["technology", "financial"] as CorporationType[];
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
export const IE_GDP_DENOMINATION_1953 = "local";

export const IE_ECONOMY: CountryEconomy = {
  currencyCode,
  nationalPolicyStateId,
  legislationScope,
  economicBaseline,
  monetary: {
    baseline: baselineMonetary,
    byEra: {
      "1971": {
        targetInflation: 9,
        neutralPrimeRate: 10,
      },
      "1979": {
        targetInflation: 12,
        neutralPrimeRate: 14,
      },
      "1991": {
        targetInflation: 3,
        neutralPrimeRate: 6,
      },
    },
  },
  sectorWeights: {
    base: sectorWeightsBase,
    byEra: {
      "1953": {
        agriculture: 22,
        manufacturing: 18,
        construction: 10,
        energy: 8,
        retail: 8,
        logistics: 5,
        financial: 5,
        real_estate: 4,
        defense: 2,
        telecommunications: 2,
        media_entertainment: 3,
        healthcare: 2,
        extraction: 1,
        automobiles: 1,
        chemical_industries: 1,
        technology: 0,
      },
      "1979": {
        agriculture: 25,
        retail: 12,
        manufacturing: 12,
        construction: 10,
        real_estate: 8,
        energy: 7,
        chemical_industries: 5,
        healthcare: 5,
        financial: 4,
        defense: 2,
        automobiles: 2,
        extraction: 2,
        logistics: 4,
        telecommunications: 2,
        technology: 1,
        media_entertainment: 7,
      },
      "1991": {
        agriculture: 9,
        manufacturing: 22,
        retail: 8,
        construction: 8,
        chemical_industries: 8,
        financial: 7,
        real_estate: 7,
        healthcare: 6,
        energy: 4,
        logistics: 4,
        automobiles: 2,
        media_entertainment: 4,
        technology: 4,
        telecommunications: 2,
        extraction: 4,
        defense: 1,
      },
    },
  },
  strategicSectors,
  repEcon,
  costScaleAnchors,
  tax: {
    neutralStateSalesTax: 0,

    treasuryPsRate,
  },
  sovereignCorpLegalStructure: "ie_plc" as LegalStructureId,
  m2ToGdp1953: 0.5,
  gdpDenomination1953: IE_GDP_DENOMINATION_1953,
};
