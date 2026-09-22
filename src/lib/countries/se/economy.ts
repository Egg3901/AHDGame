import type { CountryEconomy } from "../contract";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import type { LegalStructureId } from "@/lib/constants/legalStructures";

/**
 * SE's money.
 *
 * ⚠ GENERATED FROM `__snapshots__/se.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-economy.ts SE --force
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

const currencyCode = "SEK" as CurrencyCode;
const nationalPolicyStateId = "se_national";
const legislationScope = "se";
// No ECONOMIC_BASELINES row; the folder omits `economicBaseline` rather than defaulting it.
const baselineMonetary = {
  targetInflation: 8,
  neutralPrimeRate: 9,
};
const sectorWeightsBase = {
  manufacturing: 16,
  real_estate: 11,
  healthcare: 9,
  retail: 8,
  technology: 7,
  automobiles: 7,
  financial: 6,
  energy: 6,
  extraction: 6,
  construction: 5,
  logistics: 4,
  agriculture: 3,
  defense: 3,
  media_entertainment: 3,
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
export const SE_GDP_DENOMINATION_1953 = "local";

export const SE_ECONOMY: CountryEconomy = {
  currencyCode,
  nationalPolicyStateId,
  legislationScope,
  monetary: {
    baseline: baselineMonetary,
    byEra: {
      "1953": {
        targetInflation: 2,
        neutralPrimeRate: 3,
        trendGdpGrowth: 3.5,
      },
      "1971": {
        targetInflation: 7,
        neutralPrimeRate: 8,
        trendGdpGrowth: 2,
      },
      "1979": {
        targetInflation: 8,
        neutralPrimeRate: 9,
        trendGdpGrowth: 2,
      },
      "1991": {
        targetInflation: 4,
        neutralPrimeRate: 8,
        trendGdpGrowth: 1,
      },
    },
  },
  sectorWeights: {
    base: sectorWeightsBase,
    byEra: {
      "1953": {
        manufacturing: 26,
        energy: 10,
        agriculture: 8,
        construction: 8,
        financial: 7,
        automobiles: 6,
        logistics: 5,
        chemical_industries: 5,
        retail: 5,
        defense: 4,
        real_estate: 3,
        media_entertainment: 3,
        telecommunications: 2,
        healthcare: 3,
        extraction: 2,
        technology: 0,
      },
      "1979": {
        manufacturing: 20,
        healthcare: 10,
        energy: 7,
        retail: 8,
        construction: 7,
        automobiles: 6,
        chemical_industries: 5,
        defense: 4,
        real_estate: 5,
        financial: 4,
        agriculture: 4,
        logistics: 5,
        telecommunications: 4,
        technology: 3,
        media_entertainment: 6,
        extraction: 2,
      },
      "1991": {
        manufacturing: 16,
        real_estate: 11,
        healthcare: 9,
        retail: 8,
        technology: 7,
        automobiles: 7,
        financial: 6,
        energy: 6,
        extraction: 6,
        construction: 5,
        logistics: 4,
        agriculture: 3,
        defense: 3,
        media_entertainment: 3,
      },
    },
  },
  strategicSectors,
  tax: {
    treasuryPsRate,
  },
  sovereignCorpLegalStructure: "generic_corp" as LegalStructureId,
  m2ToGdp1953: 0.62,
  gdpDenomination1953: SE_GDP_DENOMINATION_1953,
};
