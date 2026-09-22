import type { CountryEconomy } from "../contract";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import type { LegalStructureId } from "@/lib/constants/legalStructures";

/**
 * BLR's money.
 *
 * ⚠ GENERATED FROM `__snapshots__/blr.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-economy.ts BLR --force
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
 * ⚠ NO MONETARY BASELINE FOR 1971, 1979, 1991: BLR has no entry in
 * those era tables and takes the base baseline. The key is ABSENT rather than
 * defaulted, because inventing one would turn a fallback into an authored value.
 *
 * ⚠ NO SECTOR WEIGHTS FOR 1953, 1979, for the same reason.
 */

const currencyCode = "SUR" as CurrencyCode;
const nationalPolicyStateId = "blr_national";
const legislationScope = "blr";
// No ECONOMIC_BASELINES row; the folder omits `economicBaseline` rather than defaulting it.
const baselineMonetary = {
  targetInflation: 2,
  neutralPrimeRate: 3,
};
const sectorWeightsBase = {
  manufacturing: 24,
  agriculture: 16,
  chemical_industries: 10,
  energy: 8,
  construction: 7,
  automobiles: 6,
  retail: 5,
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
export const BLR_GDP_DENOMINATION_1953 = "local";

export const BLR_ECONOMY: CountryEconomy = {
  currencyCode,
  nationalPolicyStateId,
  legislationScope,
  monetary: {
    baseline: baselineMonetary,
    byEra: {
      "1953": {
        targetInflation: 0.5,
        neutralPrimeRate: 2.5,
        trendGdpGrowth: 5,
      },
    },
  },
  sectorWeights: {
    base: sectorWeightsBase,
    byEra: {
      "1991": {
        manufacturing: 24,
        agriculture: 16,
        chemical_industries: 10,
        energy: 8,
        construction: 7,
        automobiles: 6,
        retail: 5,
      },
    },
  },
  strategicSectors,
  tax: {
    treasuryPsRate,
  },
  sovereignCorpLegalStructure: "generic_corp" as LegalStructureId,
  gdpDenomination1953: BLR_GDP_DENOMINATION_1953,
};
