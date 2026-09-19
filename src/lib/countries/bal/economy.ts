import type { CountryEconomy } from "../contract";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import type { LegalStructureId } from "@/lib/constants/legalStructures";

/**
 * BAL's money.
 *
 * ⚠ GENERATED FROM `__snapshots__/bal.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-economy.ts BAL --force
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
 * ⚠ NO MONETARY BASELINE FOR 1971, 1979, 1991: BAL has no entry in
 * those era tables and takes the base baseline. The key is ABSENT rather than
 * defaulted, because inventing one would turn a fallback into an authored value.
 */

const currencyCode = "SUR" as CurrencyCode;
const nationalPolicyStateId = "bal_national";
const legislationScope = "bal";
// No ECONOMIC_BASELINES row; the folder omits `economicBaseline` rather than defaulting it.
const baselineMonetary = {
  targetInflation: 2,
  neutralPrimeRate: 3,
};
const sectorWeightsBase = {
  manufacturing: 18,
  agriculture: 16,
  logistics: 8,
  energy: 7,
  construction: 7,
  retail: 6,
  healthcare: 5,
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
export const BAL_GDP_DENOMINATION_1953 = "local";

export const BAL_ECONOMY: CountryEconomy = {
  currencyCode,
  nationalPolicyStateId,
  legislationScope,
  monetary: {
    baseline: baselineMonetary,
    byEra: {
      "1953": {
        targetInflation: 0.5,
        neutralPrimeRate: 2.5,
        trendGdpGrowth: 4.5,
      },
    },
  },
  sectorWeights: {
    base: sectorWeightsBase,
    byEra: {
      "1953": {
        manufacturing: 22,
        extraction: 8,
        defense: 10,
        agriculture: 15,
        energy: 6,
        logistics: 6,
        chemical_industries: 5,
        construction: 6,
        healthcare: 5,
        retail: 3,
        media: 2,
        real_estate: 2,
        telecommunications: 2,
        financial: 1,
        automobiles: 1,
        entertainment: 3,
        technology: 2,
      },
      "1979": {
        manufacturing: 26,
        agriculture: 13,
        energy: 9,
        chemical_industries: 8,
        defense: 8,
        construction: 7,
        logistics: 6,
        healthcare: 5,
        retail: 4,
        extraction: 4,
        technology: 3,
        telecommunications: 2,
        entertainment: 2,
        media: 1,
        automobiles: 2,
        financial: 0,
        real_estate: 0,
      },
      "1991": {
        manufacturing: 18,
        agriculture: 16,
        logistics: 8,
        energy: 7,
        construction: 7,
        retail: 6,
        healthcare: 5,
      },
    },
  },
  strategicSectors,
  tax: {
    treasuryPsRate,
  },
  sovereignCorpLegalStructure: "generic_corp" as LegalStructureId,
  gdpDenomination1953: BAL_GDP_DENOMINATION_1953,
};
