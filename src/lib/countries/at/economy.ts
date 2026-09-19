import type { CountryEconomy } from "../contract";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import type { LegalStructureId } from "@/lib/constants/legalStructures";

/**
 * AT's money.
 *
 * ⚠ GENERATED FROM `__snapshots__/at.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-economy.ts AT --force
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
 * ⚠ NO MONETARY BASELINE FOR 1971, 1979, 1991: AT has no entry in
 * those era tables and takes the base baseline. The key is ABSENT rather than
 * defaulted, because inventing one would turn a fallback into an authored value.
 *
 * ⚠ NO SECTOR WEIGHTS FOR 1979, for the same reason.
 */

const currencyCode = "ATS" as CurrencyCode;
const nationalPolicyStateId = "at_national";
const legislationScope = "at";
// No ECONOMIC_BASELINES row; the folder omits `economicBaseline` rather than defaulting it.
const baselineMonetary = {
  targetInflation: 4,
  neutralPrimeRate: 5.5,
};
const sectorWeightsBase = {
  manufacturing: 17,
  real_estate: 12,
  retail: 9,
  financial: 8,
  construction: 8,
  healthcare: 7,
  entertainment: 7,
  energy: 6,
  logistics: 6,
  technology: 5,
  agriculture: 4,
  chemical_industries: 4,
  automobiles: 3,
  media: 2,
  extraction: 2,
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
export const AT_GDP_DENOMINATION_1953 = "local";

export const AT_ECONOMY: CountryEconomy = {
  currencyCode,
  nationalPolicyStateId,
  legislationScope,
  monetary: {
    baseline: baselineMonetary,
    byEra: {
      "1953": {
        targetInflation: 2,
        neutralPrimeRate: 4.5,
        trendGdpGrowth: 5.5,
      },
    },
  },
  sectorWeights: {
    base: sectorWeightsBase,
    byEra: {
      "1953": {
        agriculture: 22,
        manufacturing: 20,
        construction: 12,
        energy: 8,
        logistics: 7,
        retail: 7,
        extraction: 5,
        financial: 5,
        real_estate: 4,
        healthcare: 3,
        entertainment: 3,
        media: 2,
        telecommunications: 1,
        defense: 1,
      },
      "1991": {
        manufacturing: 20,
        retail: 10,
        real_estate: 10,
        construction: 9,
        financial: 8,
        entertainment: 8,
        energy: 7,
        healthcare: 6,
        logistics: 6,
        agriculture: 5,
        chemical_industries: 4,
        extraction: 3,
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
  gdpDenomination1953: AT_GDP_DENOMINATION_1953,
};
