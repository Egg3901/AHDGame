import type { CountryEconomy } from "../contract";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import type { LegalStructureId } from "@/lib/constants/legalStructures";

/**
 * US's money.
 *
 * ⚠ GENERATED FROM `__snapshots__/us.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-economy.ts US --force
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
 * ⚠ NO MONETARY BASELINE FOR 1953: US has no entry in
 * those era tables and takes the base baseline. The key is ABSENT rather than
 * defaulted, because inventing one would turn a fallback into an authored value.
 */

const currencyCode = "USD" as CurrencyCode;
const nationalPolicyStateId = "federal";
const legislationScope = "us";
const economicBaseline = {
  gdpGrowth: 2.5,
  tradeGrowth: 0,
};
const baselineMonetary = {
  targetInflation: 2,
  neutralPrimeRate: 3,
};
const sectorWeightsBase = {
  real_estate: 14,
  financial: 10,
  technology: 9,
  manufacturing: 9,
  healthcare: 9,
  retail: 7,
  construction: 6,
  logistics: 5,
  chemical_industries: 5,
  automobiles: 4,
  defense: 4,
  media: 4,
  telecommunications: 4,
  energy: 3,
  entertainment: 3,
  agriculture: 2,
  extraction: 2,
};
const repEcon = {
  gdp: 27000000000000,
  population: 333000000,
};
const costScaleAnchors = {
  gdpLow: 6200000000000,
  popLow: 252177000,
  scaleLow: 0.3,
  gdpHigh: 27000000000000,
  popHigh: 333000000,
  scaleHigh: 1.27,
};
/**
 * ⚠ THE CAST IS LOAD-BEARING, for the same reason as the cabinet groups:
 * JSON.parse widens each sector name to `string`, and `CorporationType[]` is a
 * union array. Caught by typecheck alone.
 */
const strategicSectors = ["defense", "technology"] as CorporationType[];
const treasuryPsRate = {
  national: 75000,
  state: 37500,
};

/**
 * Whether this country's authored 1953 GDP figures are denominated in USD or in
 * local currency.
 *
 * ⚠ 1953 ONLY. `GDP_DENOMINATION_1953` is an era table and holds no other
 * preset, so this says nothing about any later era.
 */
export const US_GDP_DENOMINATION_1953 = "local";

export const US_ECONOMY: CountryEconomy = {
  currencyCode,
  nationalPolicyStateId,
  legislationScope,
  economicBaseline,
  monetary: {
    baseline: baselineMonetary,
    byEra: {
      "1971": {
        targetInflation: 6,
        neutralPrimeRate: 7.5,
      },
      "1979": {
        targetInflation: 10,
        neutralPrimeRate: 12,
      },
      "1991": {
        targetInflation: 4,
        neutralPrimeRate: 6,
      },
    },
  },
  sectorWeights: {
    base: sectorWeightsBase,
    byEra: {
      "1953": {
        manufacturing: 26,
        defense: 14,
        automobiles: 10,
        agriculture: 8,
        energy: 7,
        construction: 6,
        chemical_industries: 5,
        retail: 5,
        real_estate: 4,
        logistics: 8,
        financial: 3,
        healthcare: 2,
        media: 2,
        telecommunications: 2,
        entertainment: 2,
        extraction: 2,
        technology: 0,
      },
      "1979": {
        manufacturing: 18,
        real_estate: 10,
        retail: 8,
        automobiles: 8,
        energy: 7,
        agriculture: 6,
        construction: 6,
        healthcare: 5,
        financial: 5,
        chemical_industries: 5,
        defense: 5,
        extraction: 4,
        logistics: 4,
        telecommunications: 3,
        technology: 2,
        media: 2,
        entertainment: 2,
      },
      "1991": {
        manufacturing: 14,
        financial: 9,
        real_estate: 11,
        retail: 9,
        healthcare: 7,
        construction: 7,
        automobiles: 6,
        defense: 7,
        chemical_industries: 6,
        energy: 5,
        telecommunications: 3,
        logistics: 4,
        media: 3,
        technology: 3,
        agriculture: 3,
        extraction: 2,
        entertainment: 1,
      },
    },
  },
  strategicSectors,
  repEcon,
  costScaleAnchors,
  tax: {
    neutralFederalSalesTax: 0,
    neutralStateSalesTax: 6,

    treasuryPsRate,
  },
  payoutCapPerTurn: 2000000,
  sovereignCorpLegalStructure: "us_c_corp" as LegalStructureId,
  m2ToGdp1953: 0.62,
  gdpDenomination1953: US_GDP_DENOMINATION_1953,
};
