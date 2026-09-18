import type { CountryEconomy } from "../contract";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationType } from "@/lib/constants/corporations";
import type { LegalStructureId } from "@/lib/constants/legalStructures";

/**
 * RU's money.
 *
 * ⚠ GENERATED FROM `__snapshots__/ru.pre-move.json`, NOT TRANSCRIBED.
 * Regenerate with:
 *
 *     npx tsx scripts/countries/gen-country-economy.ts RU --force
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
 * ⚠ NO SECTOR WEIGHTS FOR 1953, 1979, for the same reason.
 */

const currencyCode = "SUR" as CurrencyCode;
const nationalPolicyStateId = "su_national";
const legislationScope = "ru";
// No ECONOMIC_BASELINES row; the folder omits `economicBaseline` rather than defaulting it.
const baselineMonetary = {
  targetInflation: 2,
  neutralPrimeRate: 3,
};
const sectorWeightsBase = {
  manufacturing: 20,
  energy: 12,
  extraction: 10,
  defense: 10,
  agriculture: 12,
  chemical_industries: 8,
  construction: 7,
  automobiles: 5,
  logistics: 4,
  healthcare: 4,
  retail: 3,
  technology: 2,
  real_estate: 1,
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
  national: 500000,
  state: 250000,
};

/**
 * Whether this country's authored 1953 GDP figures are denominated in USD or in
 * local currency.
 *
 * ⚠ 1953 ONLY. `GDP_DENOMINATION_1953` is an era table and holds no other
 * preset, so this says nothing about any later era.
 */
export const RU_GDP_DENOMINATION_1953 = "local";

export const RU_ECONOMY: CountryEconomy = {
  currencyCode,
  nationalPolicyStateId,
  legislationScope,
  monetary: {
    baseline: baselineMonetary,
    byEra: {
      "1953": {
        targetInflation: 1,
        neutralPrimeRate: 2.5,
        trendGdpGrowth: 6,
      },
      "1971": {
        targetInflation: 1.5,
        neutralPrimeRate: 2.5,
        trendGdpGrowth: 3,
      },
      "1979": {
        targetInflation: 1.5,
        neutralPrimeRate: 2.5,
        trendGdpGrowth: 2.5,
      },
      "1991": {
        targetInflation: 12,
        neutralPrimeRate: 20,
        trendGdpGrowth: -5,
      },
    },
  },
  sectorWeights: {
    base: sectorWeightsBase,
    byEra: {
      "1991": {
        manufacturing: 20,
        energy: 12,
        extraction: 10,
        defense: 10,
        agriculture: 12,
        chemical_industries: 8,
        construction: 7,
        automobiles: 5,
        logistics: 4,
        healthcare: 4,
        retail: 3,
        technology: 2,
        real_estate: 1,
      },
    },
  },
  strategicSectors,
  tax: {
    treasuryPsRate,
  },
  payoutCapPerTurn: 1500000,
  sovereignCorpLegalStructure: "generic_corp" as LegalStructureId,
  m2ToGdp1953: 0.42,
  gdpDenomination1953: RU_GDP_DENOMINATION_1953,
};
