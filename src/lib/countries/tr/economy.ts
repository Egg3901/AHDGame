import type { CountryEconomy } from "../contract";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import type { LegalStructureId } from "@/lib/constants/legalStructures";

/**
 * TR's money.
 *
 * ⚠ GENERATED FROM `__snapshots__/tr.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-economy.ts TR --force
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

const currencyCode = "TRL" as CurrencyCode;
const nationalPolicyStateId = "tr_national";
const legislationScope = "tr";
// No ECONOMIC_BASELINES row; the folder omits `economicBaseline` rather than defaulting it.
const baselineMonetary = {
  targetInflation: 20,
  neutralPrimeRate: 20,
};
const sectorWeightsBase = {
  manufacturing: 16,
  agriculture: 14,
  real_estate: 11,
  retail: 9,
  construction: 8,
  automobiles: 6,
  financial: 5,
  healthcare: 5,
  energy: 5,
  logistics: 5,
  chemical_industries: 4,
  defense: 4,
  entertainment: 4,
  technology: 2,
  media: 2,
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
export const TR_GDP_DENOMINATION_1953 = "local";

export const TR_ECONOMY: CountryEconomy = {
  currencyCode,
  nationalPolicyStateId,
  legislationScope,
  monetary: {
    baseline: baselineMonetary,
    byEra: {
      "1953": {
        targetInflation: 5,
        neutralPrimeRate: 6,
        trendGdpGrowth: 6,
      },
      "1971": {
        targetInflation: 15,
        neutralPrimeRate: 15,
        trendGdpGrowth: 4,
      },
      "1979": {
        targetInflation: 20,
        neutralPrimeRate: 20,
        trendGdpGrowth: 2,
      },
      "1991": {
        targetInflation: 12,
        neutralPrimeRate: 18,
        trendGdpGrowth: 4,
      },
    },
  },
  sectorWeights: {
    base: sectorWeightsBase,
    byEra: {
      "1953": {
        agriculture: 40,
        manufacturing: 14,
        construction: 10,
        energy: 8,
        logistics: 6,
        extraction: 5,
        real_estate: 3,
        financial: 3,
        retail: 3,
        defense: 3,
        healthcare: 1,
        telecommunications: 1,
        media: 1,
        automobiles: 0,
        chemical_industries: 0,
        entertainment: 1,
        technology: 0,
      },
      "1979": {
        agriculture: 22,
        manufacturing: 15,
        construction: 10,
        retail: 10,
        energy: 8,
        extraction: 4,
        real_estate: 6,
        healthcare: 4,
        defense: 5,
        chemical_industries: 4,
        automobiles: 3,
        financial: 3,
        logistics: 4,
        telecommunications: 2,
        technology: 1,
        media: 2,
        entertainment: 3,
      },
      "1991": {
        manufacturing: 16,
        agriculture: 14,
        real_estate: 11,
        retail: 9,
        construction: 8,
        automobiles: 6,
        financial: 5,
        healthcare: 5,
        energy: 5,
        logistics: 5,
        chemical_industries: 4,
        defense: 4,
        entertainment: 4,
        technology: 2,
        media: 2,
      },
    },
  },
  strategicSectors,
  tax: {
    treasuryPsRate,
  },
  sovereignCorpLegalStructure: "generic_corp" as LegalStructureId,
  m2ToGdp1953: 0.3,
  gdpDenomination1953: TR_GDP_DENOMINATION_1953,
};
