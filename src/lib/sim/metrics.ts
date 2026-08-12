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
  inflationIndex: number;
  /** Population stdev of (globalPrice/basePrice) across commodities — cross-sectional price dispersion, not a time series. */
  priceVolatility: number;
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
  const crises = await db
    .collection<Crisis>("crises")
    .find({}, { projection: { status: 1, createdAt: 1, resolvedAt: 1 } })
    .toArray();
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
  };
}

async function collectEconomyMetrics(db: Db): Promise<EconomyMetrics> {
  const commodities = await db
    .collection("commodityPrices")
    .find({ basePrice: { $gt: 0 } }, { projection: { basePrice: 1, globalPrice: 1 } })
    .toArray();
  if (commodities.length === 0) {
    return { commodityCount: 0, inflationIndex: 1, priceVolatility: 0 };
  }
  const ratios = commodities.map((c) => (c.globalPrice ?? c.basePrice) / c.basePrice);

  return {
    commodityCount: commodities.length,
    inflationIndex: mean(ratios),
    priceVolatility: stdev(ratios),
  };
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

  const [wealth, electoral, officeTurnover, crises, economy, capacity] = await Promise.all([
    collectWealthMetrics(db),
    collectElectoralMetrics(db),
    collectOfficeTurnoverMetrics(db),
    collectCrisisMetrics(db),
    collectEconomyMetrics(db),
    collectCapacityMetrics(db),
  ]);

  return { turn, wealth, electoral, officeTurnover, crises, economy, capacity };
}
