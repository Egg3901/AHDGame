import type { CountryEconomy } from "../contract";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import type { LegalStructureId } from "@/lib/constants/legalStructures";

/**
 * BR's money.
 *
 * ⚠ GENERATED FROM `__snapshots__/br.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-economy.ts BR --force
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

const currencyCode = "BRL" as CurrencyCode;
const nationalPolicyStateId = "br_national";
const legislationScope = "br";
const economicBaseline = {
  gdpGrowth: 2.5,
  tradeGrowth: 2,
};
const baselineMonetary = {
  targetInflation: 4,
  neutralPrimeRate: 8,
};
const sectorWeightsBase = {
  agriculture: 14,
  real_estate: 11,
  energy: 9,
  extraction: 9,
  manufacturing: 9,
  financial: 8,
  retail: 7,
  construction: 7,
  chemical_industries: 6,
  logistics: 4,
  healthcare: 4,
  telecommunications: 3,
  technology: 2,
  entertainment: 2,
  media: 2,
  automobiles: 2,
  defense: 1,
};
// No REP_ECON row; the folder omits `repEcon` rather than defaulting it.
const costScaleAnchors = {
  gdpLow: 900000000000,
  popLow: 149000000,
  scaleLow: 0.12,
  gdpHigh: 10900000000000,
  popHigh: 215000000,
  scaleHigh: 1,
};
/**
 * ⚠ THE CAST IS LOAD-BEARING, for the same reason as the cabinet groups:
 * JSON.parse widens each sector name to `string`, and `CorporationType[]` is a
 * union array. Caught by typecheck alone.
 */
const strategicSectors = ["agriculture", "extraction"] as CorporationType[];
const treasuryPsRate = {
  national: 350000,
  state: 175000,
};

/**
 * Whether this country's authored 1953 GDP figures are denominated in USD or in
 * local currency.
 *
 * ⚠ 1953 ONLY. `GDP_DENOMINATION_1953` is an era table and holds no other
 * preset, so this says nothing about any later era.
 */
export const BR_GDP_DENOMINATION_1953 = "local";

export const BR_ECONOMY: CountryEconomy = {
  currencyCode,
  nationalPolicyStateId,
  legislationScope,
  economicBaseline,
  monetary: {
    baseline: baselineMonetary,
    byEra: {
      "1953": {
        targetInflation: 4,
        neutralPrimeRate: 8,
      },
      "1971": {
        targetInflation: 12,
        neutralPrimeRate: 15,
      },
      "1979": {
        targetInflation: 12,
        neutralPrimeRate: 15,
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
        agriculture: 25,
        manufacturing: 20,
        construction: 12,
        energy: 8,
        extraction: 6,
        logistics: 5,
        real_estate: 4,
        financial: 4,
        retail: 4,
        automobiles: 2,
        defense: 2,
        chemical_industries: 2,
        telecommunications: 1,
        healthcare: 1,
        media: 1,
        entertainment: 1,
        technology: 0,
      },
      "1979": {
        manufacturing: 18,
        agriculture: 16,
        energy: 10,
        extraction: 8,
        construction: 8,
        retail: 7,
        real_estate: 6,
        chemical_industries: 5,
        automobiles: 5,
        healthcare: 3,
        financial: 4,
        defense: 3,
        logistics: 4,
        telecommunications: 2,
        technology: 1,
        media: 2,
        entertainment: 2,
      },
      "1991": {
        agriculture: 14,
        manufacturing: 22,
        real_estate: 8,
        extraction: 9,
        energy: 8,
        financial: 6,
        retail: 7,
        construction: 8,
        chemical_industries: 6,
        automobiles: 4,
        logistics: 3,
        healthcare: 3,
        telecommunications: 1,
        technology: 1,
        media: 2,
        entertainment: 1,
        defense: 1,
      },
    },
  },
  strategicSectors,
  costScaleAnchors,
  tax: {
    neutralStateSalesTax: 5,

    treasuryPsRate,
  },
  sovereignCorpLegalStructure: "br_sa_aberta" as LegalStructureId,
  m2ToGdp1953: 0.28,
  gdpDenomination1953: BR_GDP_DENOMINATION_1953,
};
