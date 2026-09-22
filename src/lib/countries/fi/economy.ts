import type { CountryEconomy } from "../contract";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import type { LegalStructureId } from "@/lib/constants/legalStructures";

/**
 * FI's money.
 *
 * ⚠ GENERATED FROM `__snapshots__/fi.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-economy.ts FI --force
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
 * ⚠ NO MONETARY BASELINE FOR 1971, 1979, 1991: FI has no entry in
 * those era tables and takes the base baseline. The key is ABSENT rather than
 * defaulted, because inventing one would turn a fallback into an authored value.
 *
 * ⚠ NO SECTOR WEIGHTS FOR 1979, for the same reason.
 */

const currencyCode = "FIM" as CurrencyCode;
const nationalPolicyStateId = "fi_national";
const legislationScope = "fi";
// No ECONOMIC_BASELINES row; the folder omits `economicBaseline` rather than defaulting it.
const baselineMonetary = {
  targetInflation: 6,
  neutralPrimeRate: 8.5,
};
const sectorWeightsBase = {
  manufacturing: 18,
  technology: 10,
  real_estate: 11,
  retail: 8,
  healthcare: 8,
  financial: 6,
  construction: 6,
  energy: 6,
  logistics: 6,
  chemical_industries: 5,
  extraction: 5,
  agriculture: 4,
  media: 3,
  entertainment: 2,
  defense: 2,
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
export const FI_GDP_DENOMINATION_1953 = "local";

export const FI_ECONOMY: CountryEconomy = {
  currencyCode,
  nationalPolicyStateId,
  legislationScope,
  monetary: {
    baseline: baselineMonetary,
    byEra: {
      "1953": {
        targetInflation: 2,
        neutralPrimeRate: 4.5,
        trendGdpGrowth: 4,
      },
    },
  },
  sectorWeights: {
    base: sectorWeightsBase,
    byEra: {
      "1953": {
        agriculture: 30,
        manufacturing: 18,
        extraction: 10,
        construction: 9,
        logistics: 7,
        energy: 6,
        retail: 6,
        financial: 4,
        real_estate: 3,
        defense: 2,
        healthcare: 2,
        media: 2,
        telecommunications: 1,
      },
      "1991": {
        manufacturing: 22,
        financial: 9,
        real_estate: 10,
        retail: 9,
        construction: 8,
        energy: 7,
        extraction: 7,
        logistics: 6,
        healthcare: 6,
        agriculture: 6,
        chemical_industries: 4,
        technology: 3,
        media: 2,
        defense: 1,
      },
    },
  },
  strategicSectors,
  tax: {
    treasuryPsRate,
  },
  sovereignCorpLegalStructure: "generic_corp" as LegalStructureId,
  gdpDenomination1953: FI_GDP_DENOMINATION_1953,
};
