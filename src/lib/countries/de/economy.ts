import type { CountryEconomy } from "../contract";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import type { LegalStructureId } from "@/lib/constants/legalStructures";

/**
 * DE's money.
 *
 * ⚠ GENERATED FROM `__snapshots__/de.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-economy.ts DE --force
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

const currencyCode = "EUR" as CurrencyCode;
const nationalPolicyStateId = "de_national";
const legislationScope = "de";
const economicBaseline = {
  gdpGrowth: 1.5,
  tradeGrowth: 0,
};
const baselineMonetary = {
  targetInflation: 2,
  neutralPrimeRate: 3,
};
const sectorWeightsBase = {
  manufacturing: 14,
  automobiles: 11,
  chemical_industries: 9,
  real_estate: 9,
  financial: 8,
  technology: 8,
  logistics: 7,
  construction: 6,
  healthcare: 6,
  retail: 5,
  energy: 4,
  media: 3,
  defense: 3,
  telecommunications: 3,
  entertainment: 2,
  agriculture: 1,
  extraction: 1,
};
const repEcon = {
  gdp: 4500000000000,
  population: 84400000,
};
const costScaleAnchors = {
  gdpLow: 1600000000000,
  popLow: 80000000,
  scaleLow: 0.65,
  gdpHigh: 4500000000000,
  popHigh: 84400000,
  scaleHigh: 1.97,
};
/**
 * ⚠ THE CAST IS LOAD-BEARING, for the same reason as the cabinet groups:
 * JSON.parse widens each sector name to `string`, and `CorporationType[]` is a
 * union array. Caught by typecheck alone.
 */
const strategicSectors = ["automobiles", "energy"] as CorporationType[];
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
export const DE_GDP_DENOMINATION_1953 = "local";

export const DE_ECONOMY: CountryEconomy = {
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
        targetInflation: 4.5,
        neutralPrimeRate: 6,
      },
      "1979": {
        targetInflation: 4,
        neutralPrimeRate: 6,
      },
      "1991": {
        targetInflation: 3.5,
        neutralPrimeRate: 7,
      },
    },
  },
  sectorWeights: {
    base: sectorWeightsBase,
    byEra: {
      "1953": {
        manufacturing: 32,
        construction: 12,
        automobiles: 8,
        chemical_industries: 8,
        energy: 7,
        retail: 5,
        logistics: 5,
        financial: 4,
        agriculture: 3,
        defense: 2,
        real_estate: 2,
        telecommunications: 2,
        media: 2,
        healthcare: 2,
        extraction: 2,
        entertainment: 1,
        technology: 0,
      },
      "1979": {
        manufacturing: 28,
        automobiles: 10,
        chemical_industries: 8,
        energy: 7,
        construction: 7,
        real_estate: 6,
        retail: 7,
        agriculture: 5,
        defense: 5,
        financial: 3,
        logistics: 4,
        healthcare: 3,
        extraction: 2,
        telecommunications: 2,
        technology: 1,
        media: 1,
        entertainment: 1,
      },
      "1991": {
        manufacturing: 22,
        automobiles: 11,
        chemical_industries: 11,
        construction: 8,
        real_estate: 8,
        financial: 7,
        retail: 6,
        healthcare: 5,
        energy: 5,
        logistics: 4,
        defense: 3,
        media: 2,
        technology: 3,
        telecommunications: 2,
        entertainment: 1,
        agriculture: 1,
        extraction: 1,
      },
    },
  },
  strategicSectors,
  repEcon,
  costScaleAnchors,
  tax: {
    neutralFederalSalesTax: 19,
    neutralStateSalesTax: 0,

    treasuryPsRate,
  },
  sovereignCorpLegalStructure: "de_ag" as LegalStructureId,
  m2ToGdp1953: 0.38,
  gdpDenomination1953: DE_GDP_DENOMINATION_1953,
};
