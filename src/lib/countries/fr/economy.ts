import type { CountryEconomy } from "../contract";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import type { LegalStructureId } from "@/lib/constants/legalStructures";

/**
 * FR's money.
 *
 * ⚠ GENERATED FROM `__snapshots__/fr.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-economy.ts FR --force
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

const currencyCode = "FRF" as CurrencyCode;
const nationalPolicyStateId = "fr_national";
const legislationScope = "fr";
// No ECONOMIC_BASELINES row; the folder omits `economicBaseline` rather than defaulting it.
const baselineMonetary = {
  targetInflation: 10,
  neutralPrimeRate: 9.5,
};
const sectorWeightsBase = {
  manufacturing: 16,
  real_estate: 11,
  financial: 9,
  retail: 8,
  automobiles: 8,
  agriculture: 8,
  healthcare: 7,
  energy: 7,
  construction: 6,
  chemical_industries: 5,
  defense: 5,
  logistics: 4,
  entertainment: 3,
  technology: 2,
  media: 1,
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
export const FR_GDP_DENOMINATION_1953 = "local";

export const FR_ECONOMY: CountryEconomy = {
  currencyCode,
  nationalPolicyStateId,
  legislationScope,
  monetary: {
    baseline: baselineMonetary,
    byEra: {
      "1953": {
        targetInflation: 2,
        neutralPrimeRate: 4,
        trendGdpGrowth: 4.5,
      },
      "1971": {
        targetInflation: 7,
        neutralPrimeRate: 8.5,
        trendGdpGrowth: 3.5,
      },
      "1979": {
        targetInflation: 10,
        neutralPrimeRate: 9.5,
        trendGdpGrowth: 3,
      },
      "1991": {
        targetInflation: 3,
        neutralPrimeRate: 6,
        trendGdpGrowth: 2,
      },
    },
  },
  sectorWeights: {
    base: sectorWeightsBase,
    byEra: {
      "1953": {
        manufacturing: 25,
        agriculture: 15,
        construction: 10,
        energy: 8,
        automobiles: 6,
        chemical_industries: 5,
        financial: 5,
        retail: 5,
        logistics: 4,
        real_estate: 3,
        defense: 3,
        telecommunications: 2,
        media: 2,
        healthcare: 2,
        extraction: 2,
        entertainment: 1,
        technology: 0,
      },
      "1979": {
        manufacturing: 22,
        agriculture: 6,
        chemical_industries: 7,
        energy: 8,
        retail: 8,
        real_estate: 8,
        construction: 7,
        automobiles: 6,
        defense: 5,
        financial: 4,
        healthcare: 4,
        extraction: 2,
        logistics: 4,
        telecommunications: 3,
        technology: 1,
        media: 3,
        entertainment: 2,
      },
      "1991": {
        manufacturing: 16,
        real_estate: 11,
        financial: 9,
        retail: 8,
        automobiles: 8,
        agriculture: 8,
        healthcare: 7,
        energy: 7,
        construction: 6,
        chemical_industries: 5,
        defense: 5,
        logistics: 4,
        entertainment: 3,
        technology: 2,
        media: 1,
      },
    },
  },
  strategicSectors,
  tax: {
    treasuryPsRate,
  },
  sovereignCorpLegalStructure: "generic_corp" as LegalStructureId,
  m2ToGdp1953: 0.52,
  gdpDenomination1953: FR_GDP_DENOMINATION_1953,
};
