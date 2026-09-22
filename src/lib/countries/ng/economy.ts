import type { CountryEconomy } from "../contract";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import type { LegalStructureId } from "@/lib/constants/legalStructures";

/**
 * NG's money.
 *
 * ⚠ GENERATED FROM `__snapshots__/ng.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-economy.ts NG --force
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

const currencyCode = "NGN" as CurrencyCode;
const nationalPolicyStateId = "ng_national";
const legislationScope = "ng";
const economicBaseline = {
  gdpGrowth: 3,
  tradeGrowth: 2.5,
};
const baselineMonetary = {
  targetInflation: 6,
  neutralPrimeRate: 12,
};
const sectorWeightsBase = {
  extraction: 16,
  energy: 14,
  agriculture: 13,
  real_estate: 10,
  telecommunications: 8,
  retail: 7,
  construction: 7,
  financial: 6,
  manufacturing: 5,
  healthcare: 4,
  logistics: 3,
  chemical_industries: 2,
  technology: 2,
  media_entertainment: 2,
  defense: 1,
  automobiles: 1,
};
const repEcon = {
  gdp: 144000000000000,
  population: 200000000,
};
const costScaleAnchors = {
  gdpLow: 1800000000000,
  popLow: 95000000,
  scaleLow: 0.04,
  gdpHigh: 144000000000000,
  popHigh: 200000000,
  scaleHigh: 1,
};
/**
 * ⚠ THE CAST IS LOAD-BEARING, for the same reason as the cabinet groups:
 * JSON.parse widens each sector name to `string`, and `CorporationType[]` is a
 * union array. Caught by typecheck alone.
 */
const strategicSectors = ["extraction", "energy"] as CorporationType[];
const treasuryPsRate = {
  national: 30000000,
  state: 15000000,
};

/**
 * Whether this country's authored 1953 GDP figures are denominated in USD or in
 * local currency.
 *
 * ⚠ 1953 ONLY. `GDP_DENOMINATION_1953` is an era table and holds no other
 * preset, so this says nothing about any later era.
 */
export const NG_GDP_DENOMINATION_1953 = "usd";

export const NG_ECONOMY: CountryEconomy = {
  currencyCode,
  nationalPolicyStateId,
  legislationScope,
  economicBaseline,
  monetary: {
    baseline: baselineMonetary,
    byEra: {
      "1953": {
        targetInflation: 2,
        neutralPrimeRate: 3.5,
      },
      "1971": {
        targetInflation: 10,
        neutralPrimeRate: 10,
      },
      "1979": {
        targetInflation: 10,
        neutralPrimeRate: 10,
      },
      "1991": {
        targetInflation: 12,
        neutralPrimeRate: 15,
      },
    },
  },
  sectorWeights: {
    base: sectorWeightsBase,
    byEra: {
      "1953": {
        agriculture: 45,
        extraction: 15,
        construction: 10,
        energy: 6,
        logistics: 5,
        manufacturing: 5,
        retail: 5,
        financial: 3,
        real_estate: 2,
        healthcare: 2,
        media_entertainment: 3,
        defense: 2,
        telecommunications: 1,
        automobiles: 0,
        chemical_industries: 0,
        technology: 0,
      },
      "1979": {
        extraction: 40,
        energy: 15,
        construction: 12,
        agriculture: 10,
        retail: 7,
        manufacturing: 5,
        real_estate: 4,
        healthcare: 2,
        financial: 2,
        defense: 3,
        logistics: 4,
        telecommunications: 1,
        technology: 0,
        automobiles: 1,
        chemical_industries: 1,
        media_entertainment: 3,
      },
      "1991": {
        extraction: 30,
        agriculture: 27,
        manufacturing: 8,
        energy: 6,
        construction: 6,
        real_estate: 5,
        retail: 5,
        telecommunications: 1,
        financial: 3,
        healthcare: 2,
        logistics: 2,
        chemical_industries: 2,
        automobiles: 1,
        technology: 1,
        media_entertainment: 2,
        defense: 1,
      },
    },
  },
  strategicSectors,
  repEcon,
  costScaleAnchors,
  tax: {
    treasuryPsRate,
  },
  sovereignCorpLegalStructure: "ng_plc" as LegalStructureId,
  m2ToGdp1953: 0.25,
  gdpDenomination1953: NG_GDP_DENOMINATION_1953,
};
