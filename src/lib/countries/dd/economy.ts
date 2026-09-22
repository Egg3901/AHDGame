import type { CountryEconomy } from "../contract";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import type { LegalStructureId } from "@/lib/constants/legalStructures";

/**
 * DD's money.
 *
 * ⚠ GENERATED FROM `__snapshots__/dd.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-economy.ts DD --force
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
 * ⚠ NO MONETARY BASELINE FOR 1979, 1991: DD has no entry in
 * those era tables and takes the base baseline. The key is ABSENT rather than
 * defaulted, because inventing one would turn a fallback into an authored value.
 */

const currencyCode = "DDM" as CurrencyCode;
const nationalPolicyStateId = "dd_national";
const legislationScope = "dd";
// No ECONOMIC_BASELINES row; the folder omits `economicBaseline` rather than defaulting it.
const baselineMonetary = {
  targetInflation: 2,
  neutralPrimeRate: 5,
};
const sectorWeightsBase = {
  manufacturing: 24,
  chemical_industries: 10,
  energy: 9,
  automobiles: 7,
  agriculture: 9,
  construction: 7,
  extraction: 6,
  defense: 5,
  logistics: 5,
  healthcare: 4,
  retail: 3,
  real_estate: 2,
  technology: 2,
  entertainment: 1,
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
  national: 90000,
  state: 45000,
};

/**
 * Whether this country's authored 1953 GDP figures are denominated in USD or in
 * local currency.
 *
 * ⚠ 1953 ONLY. `GDP_DENOMINATION_1953` is an era table and holds no other
 * preset, so this says nothing about any later era.
 */
export const DD_GDP_DENOMINATION_1953 = "local";

export const DD_ECONOMY: CountryEconomy = {
  currencyCode,
  nationalPolicyStateId,
  legislationScope,
  monetary: {
    baseline: baselineMonetary,
    byEra: {
      "1953": {
        targetInflation: 0.5,
        neutralPrimeRate: 3.5,
        trendGdpGrowth: 3,
      },
      "1971": {
        targetInflation: 1.5,
        neutralPrimeRate: 2.5,
        trendGdpGrowth: 3,
      },
    },
  },
  sectorWeights: {
    base: sectorWeightsBase,
    byEra: {
      "1953": {
        manufacturing: 28,
        chemical_industries: 8,
        extraction: 8,
        defense: 12,
        energy: 6,
        agriculture: 8,
        construction: 6,
        logistics: 4,
        healthcare: 4,
        automobiles: 2,
        technology: 1,
        retail: 2,
        media: 1,
        financial: 1,
        real_estate: 1,
        telecommunications: 1,
        entertainment: 1,
      },
      "1979": {
        manufacturing: 25,
        chemical_industries: 15,
        extraction: 12,
        energy: 10,
        agriculture: 10,
        defense: 10,
        construction: 7,
        healthcare: 4,
        retail: 3,
        logistics: 4,
        telecommunications: 1,
        technology: 1,
        automobiles: 1,
        real_estate: 0,
        financial: 0,
        media: 1,
        entertainment: 1,
      },
      "1991": {
        manufacturing: 24,
        chemical_industries: 10,
        energy: 9,
        automobiles: 7,
        agriculture: 9,
        construction: 7,
        extraction: 6,
        defense: 5,
        logistics: 5,
        healthcare: 4,
        retail: 3,
        real_estate: 2,
        technology: 2,
        entertainment: 1,
      },
    },
  },
  strategicSectors,
  tax: {
    treasuryPsRate,
  },
  payoutCapPerTurn: 1500000,
  sovereignCorpLegalStructure: "generic_corp" as LegalStructureId,
  m2ToGdp1953: 0.4,
  gdpDenomination1953: DD_GDP_DENOMINATION_1953,
};
