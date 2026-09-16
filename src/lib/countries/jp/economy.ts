import type { CostScaleAnchor } from "@/lib/budget/costs";
import type { CorporationType } from "@/lib/constants/corporations";
import type { LegalStructureId } from "@/lib/constants/legalStructures";
import type { CurrencyCode, MonetaryBaseline } from "@/lib/constants/currencies";
import type { EraMonetaryBaseline } from "@/lib/constants/monetaryEra";
import type { LegislationType } from "@/lib/db/types";
import type { CountryEconomy } from "../contract";

/**
 * Japan's economy and fiscal constants. Phase D4.
 *
 * ⚠️⚠️ BALANCE SURFACE. Most of what follows is economy constants: GDP and
 * population anchors, sector weights, tax rates, cost scales. CLAUDE.md is
 * explicit that a balance change needs a GitHub issue and a scripts/sim/ report
 * before it merges. This phase is a MOVE, so every number below must equal the
 * pre-move snapshot exactly. If a value ever appears to need adjusting, that is
 * not a refactor -- stop and escalate.
 *
 * ⚠️ GENERATED FROM THE PRE-MOVE SNAPSHOT, NOT TRANSCRIBED. Hand-copying a
 * fourteen-digit GDP anchor is precisely how a balance change arrives disguised
 * as a refactor.
 *
 * ⚠️ EXCHANGE RATES ARE NOT HERE, and their absence is deliberate. INITIAL_RATES
 * and its 1953/1979/1991 variants live in the SAME FILE as COUNTRY_CURRENCY_MAP,
 * which does move -- but a rate is a fact BETWEEN two currencies, so a
 * per-country copy drifts the moment either side changes. Bucket B in
 * jpCoverage.ts. Same reasoning for the two SOE ID-range tables in budgets.ts,
 * which allocate non-overlapping numeric ranges ACROSS countries.
 */

/** JPY. The rates that convert it are relational and stay put. */
const currencyCode: CurrencyCode = "JPY";

const nationalPolicyStateId = "jp_national";

/** The scope key used by country-scoped legislation. */
const legislationScope: NonNullable<LegislationType["countryScope"]> = "jp";

const baselineMonetary: MonetaryBaseline = {
  targetInflation: 1,
  neutralPrimeRate: 1,
};

/**
 * ⚠️ FOUR era tables, not three. The plan writes them as
 * MONETARY_BASELINES_1953/1971/1979/1991, and that slash shorthand hides four
 * separate module-private consts -- it is why D1's export count was 34 and not
 * the 32 the plan stated.
 *
 * ERA_TABLES dispatches across these by year and has no country axis of its own,
 * so it does not move.
 */
const monetaryByEra: Record<string, EraMonetaryBaseline> = {
  "1953": {
    targetInflation: 2,
    neutralPrimeRate: 5.5,
  },
  "1971": {
    targetInflation: 6.5,
    neutralPrimeRate: 7,
    trendGdpGrowth: 4.5,
  },
  "1979": {
    targetInflation: 4,
    neutralPrimeRate: 6,
  },
  "1991": {
    targetInflation: 2.5,
    neutralPrimeRate: 4.5,
  },
};

/** Sector weights by era. 1979 is the manufacturing peak; 1991 the bubble. */
const sectorWeightsBase: Partial<Record<CorporationType, number>> = {
  automobiles: 13,
  manufacturing: 12,
  technology: 11,
  real_estate: 10,
  financial: 9,
  retail: 7,
  healthcare: 6,
  construction: 6,
  chemical_industries: 5,
  telecommunications: 4,
  logistics: 4,
  entertainment: 3,
  media: 3,
  energy: 2,
  defense: 2,
  agriculture: 2,
  extraction: 1,
};
const sectorWeights1979: Partial<Record<CorporationType, number>> = {
  manufacturing: 30,
  automobiles: 12,
  technology: 5,
  chemical_industries: 6,
  energy: 5,
  retail: 6,
  real_estate: 5,
  construction: 6,
  agriculture: 4,
  defense: 1,
  healthcare: 3,
  logistics: 5,
  financial: 3,
  telecommunications: 2,
  extraction: 1,
  media: 2,
  entertainment: 4,
};
const sectorWeights1991: Partial<Record<CorporationType, number>> = {
  manufacturing: 18,
  automobiles: 12,
  real_estate: 9,
  financial: 12,
  construction: 9,
  technology: 8,
  retail: 7,
  chemical_industries: 5,
  healthcare: 5,
  telecommunications: 3,
  logistics: 4,
  entertainment: 2,
  media: 2,
  energy: 2,
  defense: 1,
  agriculture: 2,
  extraction: 1,
};

const strategicSectors: CorporationType[] = ["technology", "automobiles"];

/** GDP and population anchors used to scale legislation costs. Balance surface. */
const repEcon = {
  gdp: 550000000000000,
  population: 126000000,
};

/** Cost-scale interpolation anchors. Balance surface. */
const costScaleAnchors: CostScaleAnchor = {
  gdpLow: 470000000000000,
  popLow: 124000000,
  scaleLow: 1,
  gdpHigh: 550000000000000,
  popHigh: 126000000,
  scaleHigh: 1.09,
};

const economicBaseline = {
  gdpGrowth: 1,
  tradeGrowth: 0,
};

/** Party-treasury public-support rates, national and state. */
const treasuryPsRate: { national: number; state: number } = {
  national: 5000000,
  state: 2500000,
};

export const JP_ECONOMY: CountryEconomy = {
  currencyCode,
  nationalPolicyStateId,
  legislationScope,
  economicBaseline,
  monetary: {
    baseline: baselineMonetary,
    byEra: monetaryByEra,
  },
  sectorWeights: {
    base: sectorWeightsBase,
    byEra: {
      "1979": sectorWeights1979,
      "1991": sectorWeights1991,
    },
  },
  strategicSectors,
  repEcon,
  costScaleAnchors,
  tax: {
    /** The consumption tax. */
    neutralFederalSalesTax: 10,
    /** Japan levies no state-level sales tax. */
    neutralStateSalesTax: 0,
    treasuryPsRate,
  },
  payoutCapPerTurn: 10000000,
  sovereignCorpLegalStructure: "jp_kk" as LegalStructureId,
  m2ToGdp1953: 0.45,
};
