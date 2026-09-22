import type { CountryEconomy } from "../contract";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import type { LegalStructureId } from "@/lib/constants/legalStructures";

/**
 * UK's money.
 *
 * ⚠ GENERATED FROM `__snapshots__/uk.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-economy.ts UK --force
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
 * ⚠ NO MONETARY BASELINE FOR 1953: UK has no entry in
 * those era tables and takes the base baseline. The key is ABSENT rather than
 * defaulted, because inventing one would turn a fallback into an authored value.
 */

const currencyCode = "GBP" as CurrencyCode;
const nationalPolicyStateId = "uk_national";
const legislationScope = "uk";
const economicBaseline = {
  gdpGrowth: 1.5,
  tradeGrowth: 0,
};
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
const repEcon = {
  gdp: 2900000000000,
  population: 68000000,
};
const costScaleAnchors = {
  gdpLow: 600000000000,
  popLow: 57500000,
  scaleLow: 0.31,
  gdpHigh: 2900000000000,
  popHigh: 68000000,
  scaleHigh: 1.05,
};
/**
 * ⚠ THE CAST IS LOAD-BEARING, for the same reason as the cabinet groups:
 * JSON.parse widens each sector name to `string`, and `CorporationType[]` is a
 * union array. Caught by typecheck alone.
 */
const strategicSectors = ["financial", "energy"] as CorporationType[];
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
export const UK_GDP_DENOMINATION_1953 = "local";

export const UK_ECONOMY: CountryEconomy = {
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
        targetInflation: 4.5,
        neutralPrimeRate: 8,
      },
    },
  },
  sectorWeights: {
    base: sectorWeightsBase,
    byEra: {
      "1953": {
        manufacturing: 28,
        energy: 10,
        construction: 8,
        agriculture: 6,
        chemical_industries: 6,
        logistics: 5,
        retail: 5,
        financial: 5,
        defense: 4,
        real_estate: 4,
        automobiles: 3,
        telecommunications: 2,
        media_entertainment: 4,
        healthcare: 2,
        extraction: 2,
        technology: 0,
      },
      "1979": {
        manufacturing: 22,
        energy: 9,
        retail: 9,
        real_estate: 8,
        construction: 7,
        chemical_industries: 6,
        extraction: 6,
        agriculture: 5,
        defense: 5,
        healthcare: 4,
        financial: 4,
        automobiles: 4,
        logistics: 4,
        telecommunications: 3,
        technology: 1,
        media_entertainment: 3,
      },
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
  repEcon,
  costScaleAnchors,
  tax: {
    neutralFederalSalesTax: 20,
    neutralStateSalesTax: 0,

    treasuryPsRate,
  },
  payoutCapPerTurn: 2000000,
  sovereignCorpLegalStructure: "uk_plc" as LegalStructureId,
  m2ToGdp1953: 0.58,
  gdpDenomination1953: UK_GDP_DENOMINATION_1953,
};
