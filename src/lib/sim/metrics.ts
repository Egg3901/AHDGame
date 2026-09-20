import type { Db } from "mongodb";
import type { NPP } from "@/lib/db/types/npp";
import type { Bond } from "@/lib/db/types/bond";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import type { IndexFundPosition, IndexFund } from "@/lib/db/types/indexFund";
import type { ElectedOfficial } from "@/lib/db/types/officials";
import type { Election } from "@/lib/db/types/election";
import type { ElectionVoteTally } from "@/lib/db/types/voteTally";
import type { Crisis } from "@/lib/db/types/crisis";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { loadExchangeRatesMap } from "@/lib/lineOfCredit/netWorth";
import { toInternalUnits } from "@/lib/lineOfCredit/locMath";
import type { EconomicVitalSigns } from "@/lib/db/types/economicVitalSigns";
import type { LivingConflictState } from "@/lib/livingConflict/types";

/**
 * Read-only balance-metric aggregations over a (sandbox) world DB, for the
 * headless sim's seeded-balance audit. Deliberately does NOT touch the hot
 * player-leaderboard snapshot phases (stockExchangeSnapshot.ts,
 * portfolioSnapshot.ts) — NPP wealth is aggregated directly here instead, per
 * HANDOFF.md's Phase 4 design note.
 *
 * Each section is independently best-effort: a missing/empty collection
 * produces a zeroed sub-report rather than throwing, since a 500-turn run
 * crashing on the metrics step after the expensive part (turn processing)
 * already succeeded would be the worst possible failure mode.
 */

export interface BalanceReport {
  turn: number;
  wealth: WealthMetrics;
  electoral: ElectoralMetrics;
  officeTurnover: OfficeTurnoverMetrics;
  crises: CrisisMetrics;
  economy: EconomyMetrics;
  capacity: CapacityMetrics;
  marketAccess: MarketAccessMetrics;
  /** The banking gate: a sim run is not clean unless this is open at the end. */
  banking: BankingGateMetrics;
  fiscalByCountry: FiscalCountryMetrics[];
  inflationByCountry: InflationCountryMetrics[];
  corporateCashFlow: CorporateCashFlowMetrics;
  military: MilitaryMetrics;
}

export interface FiscalCountryMetrics {
  countryId: string;
  gdp: number;
  revenue: number;
  spending: number;
  surplus: number;
  debt: number;
  debtToGdpRatio: number;
  treasuryBalance: number;
  creditRating: string;
  defenseBalance: number;
  defenseArrearsRatio: number;
}
export interface InflationCountryMetrics {
  countryId: string;
  inflation: number;
  gdp: number;
  gdpGrowth: number;
}
export interface CorporateCashFlowMetrics {
  corporationCount: number;
  totalRevenueAnchor: number;
  totalIncomeAnchor: number;
  negativeIncomeShare: number;
  byCountry: Record<string, { corporations: number; revenueAnchor: number; incomeAnchor: number }>;
}
export interface MilitaryMetrics {
  unitCount: number;
  personnel: number;
  meanReadiness: number;
  meanIntegrity: number;
  meanSupply: number;
  activeConflicts: number;
  battleReports: number;
  byCountry: Record<string, { units: number; personnel: number; meanReadiness: number }>;
}

/**
 * What a sim run must show before a banking change ships: the gate open (no
 * unfinished settlements from earlier turns, no estate stuck in resolution, no
 * savings projection drift), and how the charters ended up. The counters are
 * the turn-level product counters summed over the run's telemetry window, so
 * a run that "passed" by refusing every command is visible as such.
 */
export interface BankingGateMetrics {
  gateOpen: boolean;
  gateReasons: string[];
  activeBanks: number;
  stages: Record<string, number>;
  unfinishedSettlements: number;
  resolvingEstates: number;
  savingsMode: "off" | "shadow" | "authoritative";
  savingsDiscrepancies: number;
  counters: Record<string, number>;
}

export interface WealthMetrics {
  nppCount: number;
  totalWealth: number;
  meanWealth: number;
  medianWealth: number;
  gini: number;
  top1PctShare: number;
}

export interface ElectoralMetrics {
  totalElections: number;
  resolvedElections: number;
  contestedPct: number;
  /** Effective number of parties holding office, via the Herfindahl index (1 / sum(share_i^2)) on electedOfficials.party. */
  effectivePartyCount: number;
  /** Median winner-minus-runner-up final vote share (percentage points) over resolved, multi-candidate races. Small = competitive. 0 when there are none. */
  medianMarginPct: number;
}

export interface OfficeTurnoverMetrics {
  officeCount: number;
  nppHeldPct: number;
  meanTenureDays: number;
}

export interface CrisisMetrics {
  totalSpawned: number;
  active: number;
  resolved: number;
  meanResolutionHours: number;
  living: LivingConflictMetrics;
}

export interface LivingConflictMetricRow {
  defKey: string;
  status: string;
  phaseLevel: number;
  openedYear: number | null;
  totalTurns: number;
  tracks: Record<string, number>;
  consequences: {
    civilianStrain: number;
    refugees: number;
    infrastructureDamage: number;
    regionalSpillover: number;
    casualties: number;
    settlementMomentum: number;
  };
}

export interface LivingConflictMetrics {
  total: number;
  opened: number;
  byStatus: Record<string, number>;
  pendingDecisions: number;
  resolvedDecisions: number;
  byDefinition: LivingConflictMetricRow[];
}

export function summarizeLivingConflicts(
  livingConflicts: LivingConflictState[],
  pendingDecisions: number,
  resolvedDecisions: number
): LivingConflictMetrics {
  const byStatus: Record<string, number> = {};
  for (const conflict of livingConflicts) {
    const status = conflict.status ?? (conflict.hasOpened ? "active" : "dormant");
    byStatus[status] = (byStatus[status] ?? 0) + 1;
  }
  return {
    total: livingConflicts.length,
    opened: livingConflicts.filter((conflict) => conflict.hasOpened).length,
    byStatus,
    pendingDecisions,
    resolvedDecisions,
    byDefinition: livingConflicts
      .map((conflict) => ({
        defKey: conflict.defKey,
        status: conflict.status ?? (conflict.hasOpened ? "active" : "dormant"),
        phaseLevel: conflict.phaseLevel,
        openedYear: conflict.openedYear ?? null,
        totalTurns: conflict.totalTurns,
        tracks: conflict.tracks ?? {},
        consequences: {
          civilianStrain: conflict.campaign?.consequences.civilianStrain ?? 0,
          refugees: conflict.campaign?.consequences.refugees ?? 0,
          infrastructureDamage: conflict.campaign?.consequences.infrastructureDamage ?? 0,
          regionalSpillover: conflict.campaign?.consequences.regionalSpillover ?? 0,
          casualties: conflict.campaign?.consequences.casualties ?? 0,
          settlementMomentum: conflict.campaign?.consequences.settlementMomentum ?? 0,
        },
      }))
      .sort((a, b) => a.defKey.localeCompare(b.defKey)),
  };
}

/**
 * Plants/capital tier telemetry: the productive-capacity state a sim run is
 * actually exercising. Without these a plants run reported only revenue and
 * price aggregates — the capacity stock that DRIVES them was invisible, so a
 * run whose capacity was quietly depreciating to nothing looked identical to a
 * healthy one until GDP moved. All fields are 0 on worlds below capital tier
 * (no sector carries a capitalStock), which is the correct reading.
 */
export interface CapacityMetrics {
  /** Sectors examined (the denominator for every mean below). */
  sectorCount: number;
  totalCapitalStock: number;
  meanCapitalStock: number;
  /** Mean of persisted per-sector capitalUtilization; 0 where unset. */
  meanCapitalUtilization: number;
  totalProducedUnits: number;
  totalSoldUnits: number;
  /** Sectors that have completed the lazy plants migration (plantsStartTurn set). */
  plantsMigratedSectors: number;
}

export interface EconomyMetrics {
  commodityCount: number;
  /** GDP-weighted persisted household price index across reporting countries. */
  inflationIndex: number;
  /** GDP-weighted persisted annual household CPI rate, in percentage points. */
  inflationRate: number;
  householdCpiCountries: number;
  /** Commodity price-level diagnostics. These are shortage signals, not CPI. */
  commodityPriceLevelMean: number;
  commodityPriceLevelMedian: number;
  commodityPriceLevelP90: number;
  /** Population stdev of (globalPrice/basePrice) across commodities — cross-sectional price dispersion, not a time series. */
  priceVolatility: number;
}

export interface MarketAccessMetrics {
  pooledFillRate: number | null;
  countryScopedFillRate: number | null;
  intentFulfillmentRate: number | null;
  localShare: number | null;
  interstateShare: number | null;
  importShare: number | null;
  toleranceBoundShareOfUnmet: number | null;
  capacityBoundShareOfUnmet: number | null;
  shortageResponsiveShareOfFulfillment: number | null;
  physicalSellThrough: number | null;
  labourStaffingRate: number | null;
  marketCapHhi: number | null;
  medianOwnershipAdjustedSellerHhi: number | null;
  medianOwnershipAdjustedBuyerHhi: number | null;
  highConcentrationLowFillShare: number | null;
  emptyMarketShare: number | null;
  facilityReadyEmptyMarketShare: number | null;
  nppMarketEntryRate: number | null;
  nppEntryOutcomesExplainedShare: number | null;
  activeTradedListingShare: number | null;
  noHolderBondShare: number | null;
  sovereignNoHolderBondShare: number | null;
  corporateNoHolderBondShare: number | null;
  bondSubscriptionRate: number | null;
  corporateMedianHolders: number | null;
  corporateSubscriptionRate: number | null;
  corporateMedianPriceToParSpreadPct: number | null;
  corporateMaturityHhi: number | null;
  twoSidedListingShare: number | null;
  medianQuotedSpreadPct: number | null;
  depthToMarketCap: number | null;
  medianFilledOrderExecutionHours: number | null;
  medianAmihudIlliquidity48: number | null;
  medianTopTraderNotionalShare48: number | null;
  wealthGini: number | null;
  annualizedM2GrowthPct: number | null;
  transactionalMoneyShare: number | null;
  externalBroadMoneyShare: number | null;
  activeModeledBalanceShare48: number | null;
  modeledGrossVelocity48: number | null;
  householdTransactionalVelocity48: number | null;
  householdSavingsVelocity48: number | null;
  savingsShareOfHouseholdBalances: number | null;
  bankCashReservesAnchor: number | null;
  ringFencedShareOfLiquid: number | null;
  measurementConfidence: string;
  reconciliationStatus: string;
}

export function marketAccessMetricsFromSnapshot(
  snapshot: EconomicVitalSigns | null
): MarketAccessMetrics {
  const entryFunnel = snapshot?.marketFormation?.entryFunnel;
  return {
    pooledFillRate: snapshot?.goods.pooledFillRate.value ?? null,
    countryScopedFillRate: snapshot?.goods.countryScopedFillRate.value ?? null,
    intentFulfillmentRate: snapshot?.trade.intentFulfillmentRate.value ?? null,
    localShare: snapshot?.trade.localShare.value ?? null,
    interstateShare: snapshot?.trade.interstateShare.value ?? null,
    importShare: snapshot?.trade.importShare.value ?? null,
    toleranceBoundShareOfUnmet: snapshot?.trade.toleranceBoundShareOfUnmet.value ?? null,
    capacityBoundShareOfUnmet: snapshot?.trade.capacityBoundShareOfUnmet.value ?? null,
    shortageResponsiveShareOfFulfillment:
      snapshot?.trade.shortageResponsiveShareOfFulfillment.value ?? null,
    physicalSellThrough: snapshot?.production.physicalSellThrough.value ?? null,
    labourStaffingRate: snapshot?.production.labourStaffingRate.value ?? null,
    marketCapHhi: snapshot?.firms.marketCapHhi.value ?? null,
    medianOwnershipAdjustedSellerHhi:
      snapshot?.competition?.medianOwnershipAdjustedSellerHhi.value ?? null,
    medianOwnershipAdjustedBuyerHhi:
      snapshot?.competition?.medianOwnershipAdjustedBuyerHhi.value ?? null,
    highConcentrationLowFillShare:
      snapshot?.competition?.highConcentrationLowFillShare.value ?? null,
    emptyMarketShare: snapshot?.marketFormation?.emptyShare ?? null,
    facilityReadyEmptyMarketShare: snapshot?.marketFormation?.facilityReadyEmptyShare ?? null,
    nppMarketEntryRate:
      entryFunnel && entryFunnel.corporationsObserved > 0
        ? entryFunnel.entered / entryFunnel.corporationsObserved
        : null,
    nppEntryOutcomesExplainedShare: entryFunnel?.explainedOutcomeShare ?? null,
    activeTradedListingShare: snapshot?.securities.activeTradedListingShare.value ?? null,
    noHolderBondShare: snapshot?.securities.noHolderBondShare.value ?? null,
    sovereignNoHolderBondShare: snapshot?.securities.sovereignNoHolderBondShare?.value ?? null,
    corporateNoHolderBondShare: snapshot?.securities.corporateNoHolderBondShare?.value ?? null,
    bondSubscriptionRate: snapshot?.securities.bondSubscriptionRate.value ?? null,
    corporateMedianHolders: snapshot?.securities.corporateMedianHolders?.value ?? null,
    corporateSubscriptionRate: snapshot?.securities.corporateSubscriptionRate?.value ?? null,
    corporateMedianPriceToParSpreadPct:
      snapshot?.securities.corporateMedianPriceToParSpreadPct?.value ?? null,
    corporateMaturityHhi: snapshot?.securities.corporateMaturityHhi?.value ?? null,
    twoSidedListingShare: snapshot?.securities.twoSidedListingShare.value ?? null,
    medianQuotedSpreadPct: snapshot?.securities.medianQuotedSpreadPct.value ?? null,
    depthToMarketCap: snapshot?.securities.depthToMarketCap.value ?? null,
    medianFilledOrderExecutionHours:
      snapshot?.securities.medianFilledOrderExecutionHours.value ?? null,
    medianAmihudIlliquidity48: snapshot?.securities.medianAmihudIlliquidity48.value ?? null,
    medianTopTraderNotionalShare48:
      snapshot?.securities.medianTopTraderNotionalShare48?.value ?? null,
    wealthGini: snapshot?.households.wealthGini.value ?? null,
    annualizedM2GrowthPct: snapshot?.money.medianAnnualizedM2GrowthPct.value ?? null,
    transactionalMoneyShare: snapshot?.money.transactionalMoneyShare.value ?? null,
    externalBroadMoneyShare: snapshot?.money.externalBroadMoneyShare.value ?? null,
    activeModeledBalanceShare48: snapshot?.money.activeModeledBalanceShare48.value ?? null,
    modeledGrossVelocity48: snapshot?.money.modeledGrossVelocity48.value ?? null,
    householdTransactionalVelocity48:
      snapshot?.money.householdTransactionalVelocity48?.value ?? null,
    householdSavingsVelocity48: snapshot?.money.householdSavingsVelocity48?.value ?? null,
    savingsShareOfHouseholdBalances: snapshot?.money.savingsShareOfHouseholdBalances?.value ?? null,
    bankCashReservesAnchor: snapshot?.money.bankCashReservesAnchor?.value ?? null,
    ringFencedShareOfLiquid: snapshot?.money.ringFencedShareOfLiquid?.value ?? null,
    measurementConfidence: snapshot?.measurement.confidence ?? "unavailable",
    reconciliationStatus: snapshot?.reconciliation.status ?? "unavailable",
  };
}

/** Gini coefficient over non-negative values. 0 = perfect equality, ~1 = max concentration. */
function gini(values: number[]): number {
  const xs = values.filter((v) => v >= 0).sort((a, b) => a - b);
  const n = xs.length;
  const sum = xs.reduce((a, b) => a + b, 0);
  if (n === 0 || sum === 0) return 0;
  let weightedSum = 0;
  for (let i = 0; i < n; i++) weightedSum += (i + 1) * xs[i];
  return (2 * weightedSum) / (n * sum) - (n + 1) / n;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const xs = [...values].sort((a, b) => a - b);
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

/** A filled office has either characterId (player) or nppId (NPP) set — NOT
 * just characterId. In a full-autonomy (v3) world every seat is NPP-held, so
 * characterId is null on literally every electedOfficials doc; filtering on
 * characterId alone (an earlier version of this file did) silently zeroes out
 * every metric derived from this collection in exactly the worlds this
 * harness exists to audit. Caught via the first real 1991-default/100-turn
 * run: officeCount and effectivePartyCount both read 0 despite 1012 filled
 * NPP seats. */
const FILLED_OFFICE_FILTER = {
  $or: [{ characterId: { $ne: null } }, { nppId: { $exists: true } }],
};

/**
 * Converts a local-currency amount to internal/anchor (₳) units. Falls back
 * to treating the amount as already-anchor (rate=1) when no rate is on file
 * for the currency, rather than silently dropping it to 0 — safer than the
 * alternative for currencies forex seeding hasn't reached yet, and the only
 * way this matters in practice is if a currency is genuinely missing from
 * exchangeRates, which would itself be a seed gap worth surfacing some other
 * way, not by erasing that NPP's wealth from the report.
 */
function toAnchor(
  amount: number,
  currency: CurrencyCode,
  rates: Partial<Record<CurrencyCode, number>>
): number {
  const rate = rates[currency];
  return rate && rate > 0 ? toInternalUnits(amount, rate) : amount;
}

/** Minimal NPP shape the anchor-wealth computation needs. Any query with a
 *  superset projection (e.g. the leaderboard, which also pulls name/party)
 *  satisfies this. */
export type WealthComputableNpp = Pick<
  NPP,
  "_id" | "countryId" | "funds" | "currencyBalances" | "nppInvestmentCashAnchor"
>;

/**
 * Per-NPP total wealth in ₳ (anchor), keyed by nppId string. The single source
 * of truth for NPP wealth: funds + personal + savings balances (each FX-
 * converted from local) + nppInvestmentCashAnchor (already anchor) + bond
 * holdings + index-fund positions. Shared by the aggregate wealth metric and
 * the experiments report's wealth leaderboard so the two can never drift.
 */
export async function computeNppWealthAnchorMap(
  db: Db,
  npps: WealthComputableNpp[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (npps.length === 0) return out;

  const exchangeRates = await loadExchangeRatesMap(db);
  const nppIds = npps.map((n) => n._id);

  const bondHoldingsByNpp = new Map<string, number>();
  const bonds = await db
    .collection<Bond>("bonds")
    .find(
      { "holders.nppId": { $in: nppIds } },
      { projection: { holders: 1, currencyCode: 1, countryId: 1 } }
    )
    .toArray();
  for (const bond of bonds) {
    const bondCurrency: CurrencyCode =
      bond.currencyCode ??
      COUNTRY_CURRENCY_MAP[bond.countryId as CountryId] ??
      ("USD" as CurrencyCode);
    for (const holder of bond.holders ?? []) {
      if (!holder.nppId) continue;
      const key = String(holder.nppId);
      const value = toAnchor(
        (holder.units ?? 0) * BOND_UNIT_FACE_VALUE,
        bondCurrency,
        exchangeRates
      );
      bondHoldingsByNpp.set(key, (bondHoldingsByNpp.get(key) ?? 0) + value);
    }
  }

  const indexHoldingsByNpp = new Map<string, number>();
  const positions = await db
    .collection<IndexFundPosition>("indexFundPositions")
    .find({ holderKind: "npp", nppId: { $in: nppIds } })
    .toArray();
  if (positions.length > 0) {
    const funds = await db
      .collection<IndexFund>("indexFunds")
      .find(
        { _id: { $in: positions.map((p) => p.fundId) } },
        { projection: { quotedNav: 1, anchorCurrencyCode: 1 } }
      )
      .toArray();
    const fundById = new Map(funds.map((f) => [String(f._id), f]));
    for (const pos of positions) {
      if (!pos.nppId) continue;
      const key = String(pos.nppId);
      const fund = fundById.get(String(pos.fundId));
      const nav = fund?.quotedNav ?? 1;
      // `quotedNav` is already ₳ (fund cash, NAV and every fund leg are ₳), so
      // units × NAV is the ₳ value directly. Running it through `toAnchor` with
      // the fund's currency divided it a second time and understated NPP wealth
      // in every fund whose currency is not at parity.
      const value = (pos.units ?? 0) * nav;
      indexHoldingsByNpp.set(key, (indexHoldingsByNpp.get(key) ?? 0) + value);
    }
  }

  for (const npp of npps) {
    const key = String(npp._id);
    // NOTE: `npp.funds` is DELIBERATELY EXCLUDED. Per the NPP schema it is the
    // "campaign war chest" — the flat political-operating account NPPs spend on
    // campaigns / party org / economic actions — NOT personal net worth (which
    // lives in currencyBalances.personal/savings + the investment portfolio).
    // Including it conflated political money with personal wealth and dominated
    // the totals (aggregate `funds` ran ~25× total invested cash), grossly
    // inflating the leaderboard and Gini/top-1% — worst for office-holders who
    // never campaign (Lords, safe incumbents), which produced the spurious
    // "wealthiest NPP" outliers. War chest is reported separately by callers.
    const personal = Object.entries(npp.currencyBalances?.personal ?? {}).reduce(
      (sum, [ccy, amt]) => sum + toAnchor(amt ?? 0, ccy as CurrencyCode, exchangeRates),
      0
    );
    const savings = Object.entries(npp.currencyBalances?.savings ?? {}).reduce(
      (sum, [ccy, amt]) => sum + toAnchor(amt ?? 0, ccy as CurrencyCode, exchangeRates),
      0
    );
    out.set(
      key,
      personal +
        savings +
        (npp.nppInvestmentCashAnchor ?? 0) +
        (bondHoldingsByNpp.get(key) ?? 0) +
        (indexHoldingsByNpp.get(key) ?? 0)
    );
  }
  return out;
}

/** Per-NPP campaign war chest (`funds`) in ₳ — reported alongside, but never
 *  folded into, personal net worth (see computeNppWealthAnchorMap). */
export async function computeNppWarChestAnchorMap(
  db: Db,
  npps: WealthComputableNpp[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (npps.length === 0) return out;
  const exchangeRates = await loadExchangeRatesMap(db);
  for (const npp of npps) {
    const homeCurrency: CurrencyCode =
      COUNTRY_CURRENCY_MAP[npp.countryId as CountryId] ?? ("USD" as CurrencyCode);
    out.set(String(npp._id), toAnchor(npp.funds ?? 0, homeCurrency, exchangeRates));
  }
  return out;
}

async function collectWealthMetrics(db: Db): Promise<WealthMetrics> {
  const npps = await db
    .collection<NPP>("npps")
    .find(
      { retiredAt: null },
      {
        projection: {
          countryId: 1,
          funds: 1,
          currencyBalances: 1,
          nppInvestmentCashAnchor: 1,
        },
      }
    )
    .toArray();

  if (npps.length === 0) {
    return {
      nppCount: 0,
      totalWealth: 0,
      meanWealth: 0,
      medianWealth: 0,
      gini: 0,
      top1PctShare: 0,
    };
  }

  // Per-NPP anchor wealth via the shared source of truth (currency-conversion
  // rationale documented on computeNppWealthAnchorMap). Ranking raw local-
  // currency funds across countries would be meaningless — a JPY balance and a
  // USD balance differ ~2 orders of magnitude in raw numeral for equal real
  // value (caught in a real run where every "wealthiest NPP" was Japanese).
  const wealthMap = await computeNppWealthAnchorMap(db, npps);
  const wealths = npps.map((npp) => wealthMap.get(String(npp._id)) ?? 0);

  const totalWealth = wealths.reduce((a, b) => a + b, 0);
  const sorted = [...wealths].sort((a, b) => b - a);
  const top1Count = Math.max(1, Math.ceil(sorted.length * 0.01));
  const top1PctShare =
    totalWealth > 0 ? sorted.slice(0, top1Count).reduce((a, b) => a + b, 0) / totalWealth : 0;

  return {
    nppCount: npps.length,
    totalWealth,
    meanWealth: mean(wealths),
    medianWealth: median(wealths),
    gini: gini(wealths),
    top1PctShare,
  };
}

async function collectElectoralMetrics(db: Db): Promise<ElectoralMetrics> {
  const elections = await db
    .collection<Election>("elections")
    .find({}, { projection: { status: 1 } })
    .toArray();
  const totalElections = elections.length;
  const resolvedElections = elections.filter((e) => e.status === "resolved").length;

  const candidateCounts = await db
    .collection("electionCandidates")
    .aggregate<{ _id: unknown; count: number }>([
      { $match: { status: "active" } },
      { $group: { _id: "$electionId", count: { $sum: 1 } } },
    ])
    .toArray();
  const contestedCount = candidateCounts.filter((c) => c.count > 1).length;
  const contestedPct = candidateCounts.length > 0 ? contestedCount / candidateCounts.length : 0;

  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(FILLED_OFFICE_FILTER, { projection: { party: 1 } })
    .toArray();
  const byParty = new Map<string, number>();
  for (const o of officials) {
    const party = o.party ?? "independent";
    byParty.set(party, (byParty.get(party) ?? 0) + 1);
  }
  const totalSeats = officials.length;
  const herfindahl =
    totalSeats > 0
      ? [...byParty.values()].reduce((sum, count) => sum + (count / totalSeats) ** 2, 0)
      : 0;
  const effectivePartyCount = herfindahl > 0 ? 1 / herfindahl : 0;

  // Margin of victory: winner − runner-up final share (pp) over resolved,
  // multi-candidate races. A competitiveness signal for elections-only runs —
  // small median margin = close races, large = blowouts.
  const resolvedIds = elections.filter((e) => e.status === "resolved").map((e) => e._id);
  const margins: number[] = [];
  if (resolvedIds.length > 0) {
    const tallies = await db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .find({ electionId: { $in: resolvedIds } }, { projection: { totalVotes: 1 } })
      .toArray();
    for (const t of tallies) {
      const votes = Object.values(t.totalVotes ?? {});
      const total = votes.reduce((a, b) => a + b, 0);
      if (total <= 0 || votes.length < 2) continue;
      const sortedShares = votes.map((v) => (v / total) * 100).sort((a, b) => b - a);
      margins.push(sortedShares[0] - sortedShares[1]);
    }
  }

  return {
    totalElections,
    resolvedElections,
    contestedPct,
    effectivePartyCount,
    medianMarginPct: median(margins),
  };
}

async function collectOfficeTurnoverMetrics(db: Db): Promise<OfficeTurnoverMetrics> {
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(FILLED_OFFICE_FILTER, { projection: { isNPP: 1, electedAt: 1 } })
    .toArray();
  const officeCount = officials.length;
  if (officeCount === 0) {
    return { officeCount: 0, nppHeldPct: 0, meanTenureDays: 0 };
  }
  const nppHeld = officials.filter((o) => o.isNPP).length;
  const now = Date.now();
  const tenureDays = officials
    .filter((o) => o.electedAt)
    .map((o) => (now - new Date(o.electedAt as Date).getTime()) / 86_400_000);

  return {
    officeCount,
    nppHeldPct: nppHeld / officeCount,
    meanTenureDays: mean(tenureDays),
  };
}

async function collectCrisisMetrics(db: Db): Promise<CrisisMetrics> {
  const [crises, livingConflicts, pendingDecisions, resolvedDecisions] = await Promise.all([
    db
      .collection<Crisis>("crises")
      .find({}, { projection: { status: 1, createdAt: 1, resolvedAt: 1 } })
      .toArray(),
    db.collection<LivingConflictState>("livingConflicts").find({}).toArray(),
    db.collection("crisisInteractions").countDocuments({ resolvedAt: null }),
    db.collection("crisisInteractions").countDocuments({ resolvedAt: { $ne: null } }),
  ]);
  const totalSpawned = crises.length;
  const active = crises.filter((c) => c.status === "active").length;
  const resolvedCrises = crises.filter((c) => c.status === "resolved" && c.resolvedAt);
  const resolutionHours = resolvedCrises.map(
    (c) => (new Date(c.resolvedAt as Date).getTime() - new Date(c.createdAt).getTime()) / 3_600_000
  );
  return {
    totalSpawned,
    active,
    resolved: resolvedCrises.length,
    meanResolutionHours: mean(resolutionHours),
    living: summarizeLivingConflicts(livingConflicts, pendingDecisions, resolvedDecisions),
  };
}

type EconomyCommodityRow = { basePrice?: number; globalPrice?: number };
type EconomyBudgetRow = {
  gdp?: number;
  economicFactors?: { householdPriceIndex?: number; inflationRate?: number };
};

function weightedMean(
  rows: EconomyBudgetRow[],
  pick: (row: EconomyBudgetRow) => number | undefined,
  fallback: number
): number {
  const eligible = rows
    .map((row) => ({ value: pick(row), gdp: row.gdp }))
    .filter((row): row is { value: number; gdp: number | undefined } => Number.isFinite(row.value));
  if (!eligible.length) return fallback;
  const hasPositiveGdp = eligible.some((row) => Number.isFinite(row.gdp) && row.gdp! > 0);
  const weighted = eligible.map((row) => ({
    value: row.value,
    weight: hasPositiveGdp && Number.isFinite(row.gdp) ? Math.max(0, row.gdp!) : 1,
  }));
  const totalWeight = weighted.reduce((sum, row) => sum + row.weight, 0);
  return totalWeight > 0
    ? weighted.reduce((sum, row) => sum + row.value * row.weight, 0) / totalWeight
    : mean(weighted.map((row) => row.value));
}

export function summarizeEconomyMetrics(
  commodities: EconomyCommodityRow[],
  budgets: EconomyBudgetRow[]
): EconomyMetrics {
  const ratios = commodities
    .filter((row) => Number.isFinite(row.basePrice) && row.basePrice! > 0)
    .map((row) => (row.globalPrice ?? row.basePrice!) / row.basePrice!)
    .filter(Number.isFinite);
  const sortedRatios = [...ratios].sort((a, b) => a - b);
  const p90Index = Math.max(0, Math.ceil(sortedRatios.length * 0.9) - 1);
  const householdRows = budgets.filter((row) =>
    Number.isFinite(row.economicFactors?.householdPriceIndex)
  );
  return {
    commodityCount: ratios.length,
    inflationIndex: weightedMean(budgets, (row) => row.economicFactors?.householdPriceIndex, 1),
    inflationRate: weightedMean(budgets, (row) => row.economicFactors?.inflationRate, 0),
    householdCpiCountries: householdRows.length,
    commodityPriceLevelMean: mean(ratios),
    commodityPriceLevelMedian: median(ratios),
    commodityPriceLevelP90: sortedRatios[p90Index] ?? 0,
    priceVolatility: stdev(ratios),
  };
}

async function collectEconomyMetrics(db: Db): Promise<EconomyMetrics> {
  const [commodities, budgets] = await Promise.all([
    db
      .collection<EconomyCommodityRow>("commodityPrices")
      .find({ basePrice: { $gt: 0 } }, { projection: { basePrice: 1, globalPrice: 1 } })
      .toArray(),
    db
      .collection<EconomyBudgetRow>("federalBudget")
      .find(
        {},
        {
          projection: {
            gdp: 1,
            "economicFactors.householdPriceIndex": 1,
            "economicFactors.inflationRate": 1,
          },
        }
      )
      .toArray(),
  ]);
  return summarizeEconomyMetrics(commodities, budgets);
}

/**
 * Single pass over corporateSectors, projecting only the six capacity fields —
 * cheap enough to run unconditionally alongside the other collectors.
 */
async function collectCapacityMetrics(db: Db): Promise<CapacityMetrics> {
  const sectors = await db
    .collection("corporateSectors")
    .find(
      {},
      {
        projection: {
          _id: 0,
          capitalStock: 1,
          capitalUtilization: 1,
          producedUnits: 1,
          soldUnits: 1,
          plantsStartTurn: 1,
        },
      }
    )
    .toArray();

  const empty: CapacityMetrics = {
    sectorCount: 0,
    totalCapitalStock: 0,
    meanCapitalStock: 0,
    meanCapitalUtilization: 0,
    totalProducedUnits: 0,
    totalSoldUnits: 0,
    plantsMigratedSectors: 0,
  };
  if (sectors.length === 0) return empty;

  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

  let totalCapitalStock = 0;
  let totalUtilization = 0;
  let totalProducedUnits = 0;
  let totalSoldUnits = 0;
  let plantsMigratedSectors = 0;
  for (const s of sectors) {
    totalCapitalStock += num(s.capitalStock);
    totalUtilization += num(s.capitalUtilization);
    totalProducedUnits += num(s.producedUnits);
    totalSoldUnits += num(s.soldUnits);
    if (s.plantsStartTurn != null) plantsMigratedSectors++;
  }

  return {
    sectorCount: sectors.length,
    totalCapitalStock,
    meanCapitalStock: totalCapitalStock / sectors.length,
    meanCapitalUtilization: totalUtilization / sectors.length,
    totalProducedUnits,
    totalSoldUnits,
    plantsMigratedSectors,
  };
}

export async function collectBalanceMetrics(db: Db): Promise<BalanceReport> {
  const gameState = await db.collection("gameState").findOne({ _id: "current" as never });
  const turn = (gameState?.currentTurn as number | undefined) ?? 0;

  const [
    wealth,
    electoral,
    officeTurnover,
    crises,
    economy,
    capacity,
    vitalSigns,
    banking,
    fiscalByCountry,
    inflationByCountry,
    corporateCashFlow,
    military,
  ] = await Promise.all([
    collectWealthMetrics(db),
    collectElectoralMetrics(db),
    collectOfficeTurnoverMetrics(db),
    collectCrisisMetrics(db),
    collectEconomyMetrics(db),
    collectCapacityMetrics(db),
    db
      .collection<EconomicVitalSigns>("economicVitalSigns")
      .findOne({ turn }, { sort: { turn: -1 } }),
    collectBankingGateMetrics(db),
    collectFiscalMetrics(db),
    collectInflationMetrics(db),
    collectCorporateCashFlowMetrics(db, turn),
    collectMilitaryMetrics(db),
  ]);

  return {
    turn,
    wealth,
    electoral,
    officeTurnover,
    crises,
    economy,
    capacity,
    marketAccess: marketAccessMetricsFromSnapshot(vitalSigns),
    banking,
    fiscalByCountry,
    inflationByCountry,
    corporateCashFlow,
    military,
  };
}

async function collectFiscalMetrics(db: Db): Promise<FiscalCountryMetrics[]> {
  const rows = await db.collection("federalBudget").find({}).toArray();
  return rows
    .map((row) => ({
      countryId: String(row.countryId ?? row._id),
      gdp: Number(row.gdp ?? 0),
      revenue: Number(row.revenue?.total ?? 0),
      spending: Number(row.spending?.total ?? 0),
      surplus: Number(row.surplus ?? 0),
      debt: Number(row.debt?.principal ?? 0),
      debtToGdpRatio: Number(row.debtToGdpRatio ?? 0),
      treasuryBalance: Number(row.treasuryBalance ?? 0),
      creditRating: String(row.creditRating ?? "unknown"),
      defenseBalance: Number(row.defenseAppropriation?.balance ?? 0),
      defenseArrearsRatio: Number(row.defenseAppropriation?.arrearsRatio ?? 0),
    }))
    .sort((a, b) => a.countryId.localeCompare(b.countryId));
}

async function collectInflationMetrics(db: Db): Promise<InflationCountryMetrics[]> {
  const snapshot = await db.collection("gameHealthSnapshots").findOne({}, { sort: { turn: -1 } });
  const rows = (snapshot?.economy?.byCountry ?? {}) as Record<string, Record<string, unknown>>;
  return Object.entries(rows)
    .map(([countryId, row]) => ({
      countryId,
      inflation: Number(row.inflation ?? 0),
      gdp: Number(row.gdp ?? 0),
      gdpGrowth: Number(row.gdpGrowth ?? 0),
    }))
    .sort((a, b) => a.countryId.localeCompare(b.countryId));
}

async function collectCorporateCashFlowMetrics(
  db: Db,
  turn: number
): Promise<CorporateCashFlowMetrics> {
  const rows = await db.collection("corporationHistory").find({ turn }).toArray();
  const corps = await db
    .collection("corporations")
    .find({}, { projection: { countryOwnerId: 1, countryId: 1 } })
    .toArray();
  const countries = new Map(
    corps.map((corp) => [
      String(corp._id),
      String(corp.countryOwnerId ?? corp.countryId ?? "unknown"),
    ])
  );
  const byCountry: CorporateCashFlowMetrics["byCountry"] = {};
  let totalRevenueAnchor = 0,
    totalIncomeAnchor = 0,
    negative = 0;
  for (const row of rows) {
    const rate = Number(row.fxRateAtWrite ?? 1);
    const revenue = Number(row.revenue ?? 0) / (rate > 0 ? rate : 1);
    const income = Number(row.income ?? 0) / (rate > 0 ? rate : 1);
    const countryId = countries.get(String(row.corporationId)) ?? "unknown";
    const bucket = byCountry[countryId] ?? { corporations: 0, revenueAnchor: 0, incomeAnchor: 0 };
    bucket.corporations += 1;
    bucket.revenueAnchor += revenue;
    bucket.incomeAnchor += income;
    byCountry[countryId] = bucket;
    totalRevenueAnchor += revenue;
    totalIncomeAnchor += income;
    if (income < 0) negative += 1;
  }
  return {
    corporationCount: rows.length,
    totalRevenueAnchor,
    totalIncomeAnchor,
    negativeIncomeShare: rows.length ? negative / rows.length : 0,
    byCountry,
  };
}

async function collectMilitaryMetrics(db: Db): Promise<MilitaryMetrics> {
  const units = await db.collection("militaryUnits").find({}).toArray();
  const acc = new Map<string, { units: number; personnel: number; readiness: number }>();
  for (const unit of units) {
    const countryId = String(unit.countryId ?? "unknown");
    const bucket = acc.get(countryId) ?? { units: 0, personnel: 0, readiness: 0 };
    bucket.units += 1;
    bucket.personnel += Number(unit.personnel ?? 0);
    bucket.readiness += Number(unit.readiness ?? 0);
    acc.set(countryId, bucket);
  }
  const byCountry = Object.fromEntries(
    [...acc].map(([countryId, row]) => [
      countryId,
      {
        units: row.units,
        personnel: row.personnel,
        meanReadiness: row.units ? row.readiness / row.units : 0,
      },
    ])
  );
  const [activeConflicts, battleReports] = await Promise.all([
    db.collection("livingConflicts").countDocuments({ hasOpened: true }),
    db.collection("battleReports").countDocuments({}),
  ]);
  return {
    unitCount: units.length,
    personnel: units.reduce((sum, unit) => sum + Number(unit.personnel ?? 0), 0),
    meanReadiness: mean(units.map((unit) => Number(unit.readiness ?? 0))),
    meanIntegrity: mean(units.map((unit) => Number(unit.integrity ?? 100))),
    meanSupply: mean(units.map((unit) => Number(unit.supply ?? 100))),
    activeConflicts,
    battleReports,
    byCountry,
  };
}

export async function collectBankingGateMetrics(db: Db): Promise<BankingGateMetrics> {
  const empty: BankingGateMetrics = {
    gateOpen: true,
    gateReasons: [],
    activeBanks: 0,
    stages: {},
    unfinishedSettlements: 0,
    resolvingEstates: 0,
    savingsMode: "off",
    savingsDiscrepancies: 0,
    counters: {},
  };
  try {
    const { buildBankingHealth } = await import("@/lib/banking/health");
    const health = await buildBankingHealth(db);
    const stages: Record<string, number> = {};
    let activeBanks = 0;
    for (const currency of health.currencies) {
      activeBanks += currency.activeBanks;
      for (const [stage, count] of Object.entries(currency.stages)) {
        stages[stage] = (stages[stage] ?? 0) + (count ?? 0);
      }
    }
    const counters: Record<string, number> = {};
    for (const doc of health.telemetry) {
      for (const [name, value] of Object.entries(doc.counters ?? {})) {
        if (typeof value === "number") counters[name] = (counters[name] ?? 0) + value;
      }
    }
    return {
      gateOpen: health.gate.ok,
      gateReasons: health.gate.reasons,
      activeBanks,
      stages,
      unfinishedSettlements: health.unfinishedSettlements.count,
      resolvingEstates: health.resolvingEstates.length,
      savingsMode: health.savingsAccounts.mode,
      savingsDiscrepancies: health.savingsAccounts.comparison?.totalDiscrepancies ?? 0,
      counters,
    };
  } catch {
    // Best-effort like every other section: a metrics failure after a long
    // run must not lose the run. A closed gate is the honest default here.
    return { ...empty, gateOpen: false, gateReasons: ["banking health could not be collected"] };
  }
}
