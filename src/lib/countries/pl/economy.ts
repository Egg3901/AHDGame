import type { CountryEconomy } from "../contract";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import type { LegalStructureId } from "@/lib/constants/legalStructures";

/**
 * PL's money.
 *
 * ⚠ GENERATED FROM `__snapshots__/pl.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-economy.ts PL --force
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
 * ⚠ NO MONETARY BASELINE FOR 1979, 1991: PL has no entry in
 * those era tables and takes the base baseline. The key is ABSENT rather than
 * defaulted, because inventing one would turn a fallback into an authored value.
 */

const currencyCode = "PLZ" as CurrencyCode;
const nationalPolicyStateId = "pl_national";
const legislationScope = "pl";
// No ECONOMIC_BASELINES row; the folder omits `economicBaseline` rather than defaulting it.
const baselineMonetary = {
  targetInflation: 4,
  neutralPrimeRate: 5,
};
const sectorWeightsBase = {
  manufacturing: 22,
  agriculture: 13,
  extraction: 11,
  energy: 8,
  chemical_industries: 8,
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
export const PL_GDP_DENOMINATION_1953 = "local";

export const PL_ECONOMY: CountryEconomy = {
  currencyCode,
  nationalPolicyStateId,
  legislationScope,
  monetary: {
    baseline: baselineMonetary,
    byEra: {
      "1953": {
        targetInflation: 2,
        neutralPrimeRate: 3.5,
        trendGdpGrowth: 4,
      },
      "1971": {
        targetInflation: 2.5,
        neutralPrimeRate: 3.5,
        trendGdpGrowth: 3.5,
      },
    },
  },
  sectorWeights: {
    base: sectorWeightsBase,
    byEra: {
      "1953": {
        extraction: 15,
        manufacturing: 20,
        defense: 12,
        agriculture: 22,
        construction: 8,
        chemical_industries: 5,
        energy: 5,
        logistics: 4,
        healthcare: 4,
        retail: 1,
        media: 1,
        financial: 1,
        real_estate: 1,
        telecommunications: 1,
        automobiles: 1,
        entertainment: 1,
        technology: 0,
      },
      "1979": {
        manufacturing: 24,
        extraction: 14,
        agriculture: 12,
        defense: 10,
        chemical_industries: 8,
        energy: 7,
        construction: 7,
        logistics: 5,
        healthcare: 4,
        retail: 3,
        automobiles: 2,
        telecommunications: 1,
        media: 1,
        entertainment: 1,
        financial: 1,
        real_estate: 0,
        technology: 0,
      },
      "1991": {
        manufacturing: 22,
        agriculture: 13,
        extraction: 11,
        energy: 8,
        chemical_industries: 8,
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
  gdpDenomination1953: PL_GDP_DENOMINATION_1953,
};
