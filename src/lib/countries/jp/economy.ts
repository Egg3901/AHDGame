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
 * a relational table. Same reasoning for the two SOE ID-range tables in budgets.ts,
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

/*
 * ⚠️ DECLARED ABOVE THE OBJECT, NOT BELOW IT. `JP_ECONOMY` now references
 * this, and a `const` referenced before its declaration throws
 * `ReferenceError` at module load -- which typecheck does not catch here
 * because the reference is legal TypeScript; only running it fails.
 */
/**
 * Whether Japan's authored 1953 GDP figures are denominated in USD or in yen.
 *
 * Forwarded from `GDP_DENOMINATION_1953` in
 * `src/lib/seeds/reference/gdpDenomination.ts`.
 *
 * ⚠ 1953 ONLY. That registry is the era table and holds no other preset, so
 * this says nothing about how Japan's 1979 or modern series are denominated.
 * A later era needing its own answer gets its own const, not a widened one.
 *
 * ⚠ "usd" IS LOAD-BEARING. Japan's authored 1953 macro series are already in
 * USD, so the seeder must NOT convert them again at the JPY rate. Flipping this
 * to "local" silently multiplies Japan's 1953 GDP by roughly the yen rate.
 */
export const JP_GDP_DENOMINATION_1953 = "usd";

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
  gdpDenomination1953: JP_GDP_DENOMINATION_1953,
};

/**
 * Index-fund product names offered on the Japanese exchange.
 *
 * Forwarded from `src/lib/indexFunds/fundDefinitions.ts`.
 */
export const JP_INDEX_FUND_NAMES: Record<number, string> = {
  25: "Nikkei 25 Index",
  50: "Nikkei 50 Index",
};

/**
 * Liquid capital an NPP needs before it will buy into an index fund.
 *
 * Forwarded from `src/lib/indexFunds/nppInvesting.ts`.
 *
 * ⚠ DENOMINATED IN YEN, LIKE EVERY OTHER ENTRY IN THAT TABLE. The values are
 * LOCAL currency, not anchor units, so Japan's 34,000 is not comparable to the
 * US 80,000 -- it is roughly two orders of magnitude smaller in real terms. Do
 * not "correct" it toward its neighbours.
 */
export const JP_NPP_INVESTING_MINIMUM = 34000;

/** Which budget field carries central-to-region transfers. */
export const JP_REGIONAL_GRANT_FIELD = "nationalGrant";

/**
 * Median-income band used to score the household-income metric.
 *
 * Forwarded from `src/lib/utils/metricScoring.ts`.
 *
 * ⚠ IN YEN. 5,500,000 to 2,000,000 is a yen band, which is why it is three
 * orders of magnitude above the US entry in the same table. The scorer reads
 * each country's band against that country's own local-currency income.
 */
export const JP_MEDIAN_INCOME_BAND = { best: 5_500_000, worst: 2_000_000 };

/** Seed sector specialisation for Japanese regions with no authored override. */
export const JP_SECTOR_SPECIALIZATION = {
  primary: "automobiles",
  secondary: "technology",
} as const;

/**
 * Central-government grant multiplier applied to regional budgets at seed.
 *
 * Forwarded from `src/lib/seeds/reference/budgets.ts`.
 */
export const JP_GRANT_MULTIPLIER = 0.018;

/** Budget categories Japan overrides beyond the shared defaults. */
export const JP_EXTRA_OVERRIDE_CATEGORIES = ["infrastructure", "social"] as const;

/**
 * Default per-region tax rates applied when Japan's regions are seeded.
 *
 * Forwarded from `generateStateBudgets` in `src/lib/seeds/reference/budgets.ts`.
 *
 * ⚠ ZERO IS A RATE, NOT A GAP. Japanese prefectures levy no regional income
 * or sales tax -- those are national -- so the zeros say "this tier does not tax
 * that base", which is different from "not yet authored". Filling them in gives
 * Japan a second income tax on top of the national one.
 *
 * ⚠ FOREIGN MIRRORS DOMESTIC AT SEED, by the day-one parity rule. The two
 * are separate fields so legislators can diverge them later through the foreign
 * corporate tax bills; they start equal deliberately.
 */
export const JP_DEFAULT_REGIONAL_TAX_RATES = {
  incomeTax: 0,
  salesTax: 0,
  domesticCorporateTax: 1.5,
  foreignCorporateTax: 1.5,
  propertyTax: 1.4,
};
