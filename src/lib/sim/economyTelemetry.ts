import type { Db } from "mongodb";
import { accountKind } from "@/lib/ledger/accounts";
import { US_STATES } from "@/lib/constants";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import { PRICE_REALIZATION_MIN } from "@/lib/market/priceRealization";
import {
  getAdvertiseActionCost,
  getAdvertiseFundCost,
  getBuildDonorBaseFundCost,
  getCampaignActionCost,
  getCampaignFundCost,
  getDonorActionCost,
} from "@/lib/actions";
import { getGdpBaseline } from "@/lib/utils/fundGeneration";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";

/**
 * Post-run economy telemetry for the #2159 program acceptances
 * (#968, #991, #992, #2119, #2120, #2122).
 *
 * Collected ONCE per sim run, after turn processing completes
 * (see collectBalanceMetrics), so it costs the turn hot path nothing.
 * Every section is independently best-effort: a missing/empty collection
 * yields a zeroed section with `available: false` and a `note`, never a
 * throw. All filtering/grouping happens in JS over projected finds so the
 * collectors stay portable across real and fake DBs; the committed test
 * fake honors Mongo-style query filters, so any predicate later pushed
 * into a query is actually exercised instead of passing silently.
 *
 * Two deliberate non-goals, documented so a missing gate is never mistaken
 * for a passing one:
 * - #991 resident-vs-local-producer demand classification: no persisted
 *   field distinguishes them in this tree, so coverage reports presence
 *   only and says so explicitly.
 * - #991 NPP-entry rejection reasons: no funnel/rejection rows exist in
 *   this tree, so the section reports availability only.
 */

/** Number of trailing reconciliation turns retained (#992: 12-turn gate + margin). */
export const RECON_TRAILING_TURNS = 16;
/** Trailing window for fund / commodity means. */
export const TRAILING_TURNS = 12;

/**
 * Fragile-market set for #991 supplier breadth/fill. No canonical
 * FRAGILE_COMMODITIES constant exists in this tree; the set is taken
 * verbatim from #991's gate text (advertising, fertilizers, freight,
 * rare earths) so the report can express the gate metric.
 */
export const FRAGILE_COMMODITIES: readonly string[] = [
  "advertising",
  "fertilizers",
  "freight",
  "rare_earth",
];

export interface ReconSeriesPoint {
  turn: number;
  status: string;
  entriesChecked: number;
  trialBalanceStatus: string;
  unbalancedCount: number;
  stockVsFlowStatus: string;
  stockSkipped: boolean;
  divergentCount: number;
  unattributedCount: number;
  /** Sum of |netDrift| over money-supply findings that turn (anchor). */
  moneyNetDriftAbs: number;
}

export interface DivergenceByKind {
  kind: string;
  /** Stock-vs-flow findings against this kind inside the window. */
  findings: number;
  /** Sum of |divergence| (anchor) inside the window. */
  absDivergence: number;
}

export interface ReconciliationTelemetry {
  available: boolean;
  note: string;
  latestTurn: number | null;
  coveredTurns: number;
  series: ReconSeriesPoint[];
  byAccountKind: DivergenceByKind[];
}

export interface FundKindTotals {
  kind: string;
  count: number;
  amountAnchor: number;
}

export interface FundTelemetry {
  available: boolean;
  note: string;
  lifetime: FundKindTotals[];
  trailing: FundKindTotals[];
  trailingTurns: { from: number; to: number };
  redemptionQueue: {
    byStatus: { status: string; count: number }[];
    unresolvedCount: number;
    unresolvedUnits: number;
    unresolvedRequestedAnchor: number;
    unresolvedPaidAnchor: number;
  };
  orphanPositions: { count: number; units: number };
  flags: {
    nppFundRedemptionEnabled: { requested: boolean | null; available: boolean };
  };
}

/** CEO classes mirror Corporation.ceoType in src/lib/db/types/corporation.ts. */
export type CeoClass = "npp" | "character" | "imperial" | "unknown";

export interface CorpHealthCell {
  sectorType: string;
  ceoClass: CeoClass;
  corps: number;
  cashNegative: number;
  cashNegativeShare: number;
}

export interface BindingInputRow {
  input: string;
  sectors: number;
}

export interface CorpHealthTelemetry {
  available: boolean;
  note: string;
  corpsExamined: number;
  sectorsExamined: number;
  bySectorCeo: CorpHealthCell[];
  bindingInputs: BindingInputRow[];
  sectorsWithBindingInput: number;
  sectorsThroughputBelowOne: number;
}

export interface EraCostTelemetry {
  available: boolean;
  note: string;
  preset: string;
  startingYear: number | null;
  currentYear: number | null;
  flags: {
    campaignEraPriceLevelEnabled: { requested: boolean | null; available: boolean };
  };
  /**
   * Deterministic reference costs from the existing pure action-cost
   * functions at fixed documented inputs (no DB dependence), so a replay
   * can diff cost behavior across eras/flags without re-running turns.
   */
  referenceCosts: {
    actionPoints: { campaign: number[]; advertise: number[]; donorBuild: number[] };
    fundsAtNationalAverageGdp: { campaign: number[]; advertise: number; donorBuildL25: number };
  };
}

export interface CoverageTelemetry {
  available: boolean;
  note: string;
  usStates: number;
  sectorTypes: number;
  presentCombos: number;
  emptyCombos: number;
  emptyShare: number;
  /** Every empty US state x sectorType combo, "ST:sectorType", sorted. Bounded (states x types). */
  emptyCombinations: string[];
  sectorsExamined: number;
  meanSoldFraction: number | null;
  sectorsBelowFullClearing: number;
  fragile: { commodity: string; supply: number; demand: number; fill: number | null }[];
  residentLocalDemandClassification: { available: boolean; note: string };
  entryRejectionFunnel: {
    available: boolean;
    note: string;
    corporationsObserved: number;
    entered: number;
    rejected: number;
    explainedOutcomeShare: number | null;
    reasonCounts: Record<string, number>;
  };
}

export interface MarketTelemetry {
  available: boolean;
  note: string;
  sectorsExamined: number;
  meanSoldFraction: number | null;
  belowFullClearingShare: number;
  floorBoundShare: number | null;
  globalFill: number | null;
  trailingMeanGlobalFill: number | null;
  bonds: {
    examined: number;
    meanSubscribedShare: number | null;
    holderlessCount: number;
    holderlessShare: number;
  };
  listings: {
    byStatus: { status: string; count: number }[];
    openTakenShare: number | null;
  };
}

export interface EconomyTelemetry {
  reconciliation: ReconciliationTelemetry;
  funds: FundTelemetry;
  corpHealth: CorpHealthTelemetry;
  eraCosts: EraCostTelemetry;
  coverage: CoverageTelemetry;
  market: MarketTelemetry;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function str(v: unknown, fallback = "unknown"): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function emptyReconciliation(note: string): ReconciliationTelemetry {
  return {
    available: false,
    note,
    latestTurn: null,
    coveredTurns: 0,
    series: [],
    byAccountKind: [],
  };
}

function emptyFunds(note: string): FundTelemetry {
  return {
    available: false,
    note,
    lifetime: [],
    trailing: [],
    trailingTurns: { from: 0, to: 0 },
    redemptionQueue: {
      byStatus: [],
      unresolvedCount: 0,
      unresolvedUnits: 0,
      unresolvedRequestedAnchor: 0,
      unresolvedPaidAnchor: 0,
    },
    orphanPositions: { count: 0, units: 0 },
    flags: { nppFundRedemptionEnabled: { requested: null, available: false } },
  };
}

function emptyCorpHealth(note: string): CorpHealthTelemetry {
  return {
    available: false,
    note,
    corpsExamined: 0,
    sectorsExamined: 0,
    bySectorCeo: [],
    bindingInputs: [],
    sectorsWithBindingInput: 0,
    sectorsThroughputBelowOne: 0,
  };
}

function emptyCoverage(note: string): CoverageTelemetry {
  return {
    available: false,
    note,
    usStates: US_STATES.length,
    sectorTypes: CORPORATION_TYPES.length,
    presentCombos: 0,
    emptyCombos: 0,
    emptyShare: 0,
    emptyCombinations: [],
    sectorsExamined: 0,
    meanSoldFraction: null,
    sectorsBelowFullClearing: 0,
    fragile: [],
    residentLocalDemandClassification: {
      available: false,
      note: "No persisted field distinguishes resident from local-producer demand; coverage reports presence only.",
    },
    entryRejectionFunnel: {
      available: false,
      note: "No persisted NPP-entry funnel snapshot is available.",
      corporationsObserved: 0,
      entered: 0,
      rejected: 0,
      explainedOutcomeShare: null,
      reasonCounts: {},
    },
  };
}

function emptyMarket(note: string): MarketTelemetry {
  return {
    available: false,
    note,
    sectorsExamined: 0,
    meanSoldFraction: null,
    belowFullClearingShare: 0,
    floorBoundShare: null,
    globalFill: null,
    trailingMeanGlobalFill: null,
    bonds: { examined: 0, meanSubscribedShare: null, holderlessCount: 0, holderlessShare: 0 },
    listings: { byStatus: [], openTakenShare: null },
  };
}

async function collectReconciliation(db: Db): Promise<ReconciliationTelemetry> {
  const docs = await db
    .collection("ledgerReconciliations")
    .find(
      {},
      {
        projection: {
          turn: 1,
          status: 1,
          entriesChecked: 1,
          trialBalance: 1,
          stockVsFlow: 1,
          moneySupply: 1,
          unattributed: 1,
        },
      }
    )
    .toArray();
  if (docs.length === 0) return emptyReconciliation("ledgerReconciliations is empty.");
  const sorted = [...docs].sort((a, b) => num(a.turn) - num(b.turn));
  const window = sorted.slice(-RECON_TRAILING_TURNS);
  const series: ReconSeriesPoint[] = window.map((d) => ({
    turn: num(d.turn),
    status: str(d.status),
    entriesChecked: num(d.entriesChecked),
    trialBalanceStatus: str(d.trialBalance?.status),
    unbalancedCount: num(d.trialBalance?.unbalancedCount),
    stockVsFlowStatus: str(d.stockVsFlow?.status),
    stockSkipped: d.stockVsFlow?.skipped === true,
    divergentCount: num(d.stockVsFlow?.divergentCount),
    unattributedCount: Array.isArray(d.unattributed) ? d.unattributed.length : 0,
    moneyNetDriftAbs: Array.isArray(d.moneySupply?.findings)
      ? d.moneySupply.findings.reduce(
          (s: number, f: { netDrift?: unknown }) => s + Math.abs(num(f.netDrift)),
          0
        )
      : 0,
  }));
  const byKind = new Map<string, { findings: number; absDivergence: number }>();
  for (const d of window) {
    const findings = d.stockVsFlow?.findings;
    if (!Array.isArray(findings)) continue;
    for (const f of findings as { account?: unknown; divergence?: unknown }[]) {
      const kind = typeof f.account === "string" ? accountKind(f.account) : "unknown";
      const slot = byKind.get(kind) ?? { findings: 0, absDivergence: 0 };
      slot.findings += 1;
      slot.absDivergence += Math.abs(num(f.divergence));
      byKind.set(kind, slot);
    }
  }
  const byAccountKind: DivergenceByKind[] = [...byKind.entries()]
    .map(([kind, v]) => ({ kind, findings: v.findings, absDivergence: v.absDivergence }))
    .sort((a, b) => b.absDivergence - a.absDivergence);
  return {
    available: true,
    note: `Trailing ${window.length} reconciliation turn(s).`,
    latestTurn: series.length ? series[series.length - 1].turn : null,
    coveredTurns: series.length,
    series,
    byAccountKind,
  };
}

/**
 * Every IndexFundTransactionKind in src/lib/db/types/indexFund.ts. The
 * summaries below emit one row per kind present in the data plus an `other`
 * bucket for any unrecognized kind, so no anchor value is silently dropped.
 */
const FUND_FLOW_KINDS = [
  "subscription",
  "redemption",
  "redemption_queued",
  "public_float_buy",
  "public_float_sell",
  "dividend_reinvest",
  "dividend_pass_through",
  "bond_allocation",
  "rebalance",
  "cross_fund_buy",
  "cross_fund_sell",
  "capital_injection",
  "sponsor_seed_capital",
  "expense_fee",
  "wind_up_distribution",
  "seed_capital_return",
] as const;

async function collectFunds(db: Db, currentTurn: number): Promise<FundTelemetry> {
  const [txs, queue, positions, funds, gs] = await Promise.all([
    db
      .collection("indexFundTransactions")
      .find({}, { projection: { kind: 1, turn: 1, amountAnchor: 1 } })
      .toArray(),
    db
      .collection("indexFundRedemptionQueue")
      .find(
        {},
        { projection: { status: 1, units: 1, requestedAmountAnchor: 1, paidAmountAnchor: 1 } }
      )
      .toArray(),
    db
      .collection("indexFundPositions")
      .find({}, { projection: { fundId: 1, units: 1 } })
      .toArray(),
    db
      .collection("indexFunds")
      .find({}, { projection: { _id: 1 } })
      .toArray(),
    db.collection("gameState").findOne({ _id: "current" as never }),
  ]);
  if (txs.length === 0 && queue.length === 0 && positions.length === 0) {
    return emptyFunds(
      "indexFundTransactions, indexFundRedemptionQueue and indexFundPositions are all empty."
    );
  }
  const maxDocTurn = txs.reduce((m, t) => Math.max(m, num(t.turn)), 0);
  const to = Math.max(currentTurn, maxDocTurn);
  const from = Math.max(0, to - (TRAILING_TURNS - 1));
  const summarize = (rows: typeof txs): FundKindTotals[] => {
    const known = new Set<string>(FUND_FLOW_KINDS);
    const out: FundKindTotals[] = FUND_FLOW_KINDS.map((kind) => {
      const inKind = rows.filter((t) => t.kind === kind);
      return {
        kind,
        count: inKind.length,
        amountAnchor: inKind.reduce((s, t) => s + num(t.amountAnchor), 0),
      };
    });
    const other = rows.filter((t) => !known.has(t.kind as string));
    out.push({
      kind: "other",
      count: other.length,
      amountAnchor: other.reduce((s, t) => s + num(t.amountAnchor), 0),
    });
    return out.filter((r) => r.kind === "other" || r.count > 0 || rows.length === 0);
  };
  const trailing = txs.filter((t) => typeof t.turn === "number" && t.turn >= from && t.turn <= to);

  const byStatus = new Map<string, number>();
  let unresolvedCount = 0;
  let unresolvedUnits = 0;
  let unresolvedRequestedAnchor = 0;
  let unresolvedPaidAnchor = 0;
  for (const q of queue) {
    const status = str(q.status);
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    if (q.status === "queued" || q.status === "partial") {
      unresolvedCount += 1;
      unresolvedUnits += num(q.units);
      unresolvedRequestedAnchor += num(q.requestedAmountAnchor);
      unresolvedPaidAnchor += num(q.paidAmountAnchor);
    }
  }

  const fundIds = new Set(funds.map((f) => String(f._id)));
  let orphanCount = 0;
  let orphanUnits = 0;
  for (const p of positions) {
    if (!fundIds.has(String(p.fundId))) {
      orphanCount += 1;
      orphanUnits += num(p.units);
    }
  }

  const rawFlag = (gs as Record<string, unknown> | null)?.["nppFundRedemptionEnabled"];
  return {
    available: true,
    note: `Lifetime legs plus trailing turns ${from}-${to} cover every IndexFundTransactionKind present in the data; unrecognized kinds aggregate under "other" (count 0 = none seen). Window end = max(currentTurn, max tx turn), so future-dated rows can shift the window. Orphans = positions whose fundId has no indexFunds row.`,
    lifetime: summarize(txs),
    trailing: summarize(trailing),
    trailingTurns: { from, to },
    redemptionQueue: {
      byStatus: [...byStatus.entries()]
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => a.status.localeCompare(b.status)),
      unresolvedCount,
      unresolvedUnits,
      unresolvedRequestedAnchor,
      unresolvedPaidAnchor,
    },
    orphanPositions: { count: orphanCount, units: orphanUnits },
    flags: {
      nppFundRedemptionEnabled: {
        requested: typeof rawFlag === "boolean" ? rawFlag : null,
        available: typeof rawFlag === "boolean",
      },
    },
  };
}

function ceoClassOf(ceoType: unknown): CeoClass {
  return ceoType === "npp" || ceoType === "character" || ceoType === "imperial"
    ? ceoType
    : "unknown";
}

async function collectCorpHealth(db: Db): Promise<CorpHealthTelemetry> {
  const [corps, sectors] = await Promise.all([
    db
      .collection("corporations")
      .find({}, { projection: { type: 1, ceoType: 1, liquidCapital: 1, suspended: 1 } })
      .toArray(),
    db
      .collection("corporateSectors")
      .find(
        {},
        {
          projection: {
            corporationId: 1,
            sectorType: 1,
            throughputFactor: 1,
            throughputBindingInput: 1,
          },
        }
      )
      .toArray(),
  ]);
  if (corps.length === 0 && sectors.length === 0) {
    return emptyCorpHealth("corporations and corporateSectors are both empty.");
  }
  const live = corps.filter((c) => c.suspended !== true);

  const cells = new Map<string, { corps: number; cashNegative: number }>();
  for (const c of live) {
    const key = `${str(c.type, "unknown")}|${ceoClassOf(c.ceoType)}`;
    const slot = cells.get(key) ?? { corps: 0, cashNegative: 0 };
    slot.corps += 1;
    if (num(c.liquidCapital) < 0) slot.cashNegative += 1;
    cells.set(key, slot);
  }
  const bySectorCeo: CorpHealthCell[] = [...cells.entries()]
    .map(([key, v]) => {
      const [sectorType, ceoClass] = key.split("|");
      return {
        sectorType,
        ceoClass: ceoClass as CeoClass,
        corps: v.corps,
        cashNegative: v.cashNegative,
        cashNegativeShare: v.corps > 0 ? v.cashNegative / v.corps : 0,
      };
    })
    .sort(
      (a, b) => a.sectorType.localeCompare(b.sectorType) || a.ceoClass.localeCompare(b.ceoClass)
    );

  const bindingCounts = new Map<string, number>();
  let sectorsWithBindingInput = 0;
  let sectorsThroughputBelowOne = 0;
  for (const s of sectors) {
    const input = s.throughputBindingInput;
    if (typeof input === "string" && input.length > 0) {
      sectorsWithBindingInput += 1;
      bindingCounts.set(input, (bindingCounts.get(input) ?? 0) + 1);
    }
    if (typeof s.throughputFactor === "number" && s.throughputFactor < 1 - 1e-9) {
      sectorsThroughputBelowOne += 1;
    }
  }
  const bindingInputs: BindingInputRow[] = [...bindingCounts.entries()]
    .map(([input, sectorCount]) => ({ input, sectors: sectorCount }))
    .sort((a, b) => b.sectors - a.sectors)
    .slice(0, 12);
  return {
    available: true,
    note: "Corp cells key sectorType x CEO class (npp, character, imperial; unknown when ceoType is unset). Cash-negative = liquidCapital < 0 (sign is FX-invariant). Binding inputs list the top 12 by sector count. Inputs read persisted throughputBindingInput telemetry.",
    corpsExamined: live.length,
    sectorsExamined: sectors.length,
    bySectorCeo,
    bindingInputs,
    sectorsWithBindingInput,
    sectorsThroughputBelowOne,
  };
}

async function collectEraCosts(db: Db): Promise<EraCostTelemetry> {
  const gs = await db.collection("gameState").findOne({ _id: "current" as never });
  const g = (gs ?? {}) as Record<string, unknown>;
  const rawFlag = g["campaignEraPriceLevelEnabled"];
  // Deterministic reference inputs at exactly national-average GDP, so the
  // GDP scalar is 1.0 and the numbers below are pure function snapshots.
  const baseline = getGdpBaseline("US");
  const refPop = 1_000_000;
  const refGdpMillions = (baseline * refPop) / 1_000_000;
  const influences = [0, 20, 40, 60, 80];
  const campaign = influences.map((i) => getCampaignActionCost(i));
  const advertise = influences.map((i) => getAdvertiseActionCost(i));
  const donorBuild = [0, 25, 50, 75].map((l) => getDonorActionCost(l, "buildDonorBase"));
  return {
    available: true,
    note: "Reference costs pin the pure action-cost functions at fixed inputs; they move only when the cost code changes.",
    preset: typeof g["preset"] === "string" ? (g["preset"] as string) : "unknown",
    startingYear: typeof g["startingYear"] === "number" ? (g["startingYear"] as number) : null,
    currentYear: typeof g["currentYear"] === "number" ? (g["currentYear"] as number) : null,
    flags: {
      campaignEraPriceLevelEnabled: {
        requested: typeof rawFlag === "boolean" ? rawFlag : null,
        available: typeof rawFlag === "boolean",
      },
    },
    referenceCosts: {
      actionPoints: { campaign, advertise, donorBuild },
      fundsAtNationalAverageGdp: {
        campaign: influences.map((i) => getCampaignFundCost(i, refGdpMillions, refPop, "US")),
        advertise: getAdvertiseFundCost(0, refGdpMillions, refPop, "US"),
        donorBuildL25: getBuildDonorBaseFundCost(25, refGdpMillions, refPop, "US"),
      },
    },
  };
}

async function collectCoverage(db: Db): Promise<CoverageTelemetry> {
  const [sectors, commodities, vitalSigns] = await Promise.all([
    db
      .collection("corporateSectors")
      .find({}, { projection: { countryId: 1, stateId: 1, sectorType: 1, soldFraction: 1 } })
      .toArray(),
    db
      .collection("commodityPrices")
      .find({}, { projection: { commodity: 1, globalSupply: 1, globalDemand: 1 } })
      .toArray(),
    db.collection("economicVitalSigns").findOne({}, { sort: { turn: -1 } }),
  ]);
  const base = emptyCoverage("corporateSectors is empty.");
  const rawFunnel = (vitalSigns?.marketFormation as Record<string, unknown> | undefined)
    ?.entryFunnel as Record<string, unknown> | undefined;
  const corporationsObserved = num(rawFunnel?.corporationsObserved);
  const entered = num(rawFunnel?.entered);
  const rejected = num(rawFunnel?.rejected);
  const explainedOutcomeShare =
    typeof rawFunnel?.explainedOutcomeShare === "number" ? rawFunnel.explainedOutcomeShare : null;
  const reasonCounts = Object.fromEntries(
    Object.entries((rawFunnel?.reasonCounts as Record<string, unknown> | undefined) ?? {})
      .filter((entry): entry is [string, number] => typeof entry[1] === "number")
      .sort(([a], [b]) => a.localeCompare(b))
  );
  const entryRejectionFunnel = rawFunnel
    ? {
        available: true,
        note: "Latest persisted economic-vital-signs NPP entry funnel.",
        corporationsObserved,
        entered,
        rejected,
        explainedOutcomeShare,
        reasonCounts,
      }
    : base.entryRejectionFunnel;
  if (sectors.length === 0) return { ...base, entryRejectionFunnel };
  const present = new Set<string>();
  for (const s of sectors) {
    if (s.countryId === "US" && typeof s.stateId === "string" && typeof s.sectorType === "string") {
      present.add(`${s.stateId}:${s.sectorType}`);
    }
  }
  const universe = US_STATES.length * CORPORATION_TYPES.length;
  const emptyCombinations: string[] = [];
  for (const st of US_STATES) {
    for (const t of CORPORATION_TYPES) {
      if (!present.has(`${st}:${t}`)) emptyCombinations.push(`${st}:${t}`);
    }
  }
  emptyCombinations.sort();
  const presentCombos = universe - emptyCombinations.length;

  // Same US-only population as presence/empty combos above: non-US rows
  // carry different market structures and must not move the US mean.
  const usFractions = sectors
    .filter((s) => s.countryId === "US")
    .map((s) => s.soldFraction)
    .filter((v): v is number => typeof v === "number");
  const meanSold = usFractions.length
    ? usFractions.reduce((a, b) => a + b, 0) / usFractions.length
    : null;
  const belowFull = usFractions.filter((v) => v < 1 - 1e-9).length;

  const supplyByCommodity = new Map<string, { supply: number; demand: number }>();
  for (const c of commodities) {
    const key = str(c.commodity, "");
    if (!key) continue;
    supplyByCommodity.set(key, { supply: num(c.globalSupply), demand: num(c.globalDemand) });
  }
  const fragile = FRAGILE_COMMODITIES.map((commodity) => {
    const row = supplyByCommodity.get(commodity);
    const supply = row?.supply ?? 0;
    const demand = row?.demand ?? 0;
    return { commodity, supply, demand, fill: demand > 0 ? supply / demand : null };
  });
  return {
    ...base,
    available: true,
    note: "Presence = at least one corporateSectors row for the US state x sectorType combo. Empty combos list every gap; meanSoldFraction and sectorsBelowFullClearing cover US rows only (sectorsExamined counts all rows). Positive-use filtering is unavailable (see residentLocalDemandClassification).",
    presentCombos,
    emptyCombos: emptyCombinations.length,
    emptyShare: universe > 0 ? emptyCombinations.length / universe : 0,
    emptyCombinations,
    sectorsExamined: sectors.length,
    meanSoldFraction: meanSold,
    sectorsBelowFullClearing: belowFull,
    fragile,
    entryRejectionFunnel,
  };
}

async function collectMarket(db: Db): Promise<MarketTelemetry> {
  const [sectors, commodities, history, bonds, listings, gs] = await Promise.all([
    db
      .collection("corporateSectors")
      .find({}, { projection: { soldFraction: 1, priceRealization: 1 } })
      .toArray(),
    db
      .collection("commodityPrices")
      .find({}, { projection: { commodity: 1, globalSupply: 1, globalDemand: 1 } })
      .toArray(),
    db
      .collection("commodityPriceHistory")
      .find({}, { projection: { turn: 1, globalSupply: 1, globalDemand: 1 } })
      .toArray(),
    db
      .collection("bonds")
      .find(
        {},
        {
          projection: {
            totalIssued: 1,
            publicFloat: 1,
            holders: 1,
            centralBankHoldings: 1,
            qeSupportRatio: 1,
          },
        }
      )
      .toArray(),
    db
      .collection("shareListings")
      .find({}, { projection: { status: 1, sharesListed: 1, sharesRemaining: 1 } })
      .toArray(),
    db.collection("gameState").findOne({ _id: "current" as never }),
  ]);
  if (
    sectors.length === 0 &&
    commodities.length === 0 &&
    bonds.length === 0 &&
    listings.length === 0
  ) {
    return emptyMarket("corporateSectors, commodityPrices, bonds and shareListings are all empty.");
  }
  const fractions = sectors
    .map((s) => s.soldFraction)
    .filter((v): v is number => typeof v === "number");
  const meanSold = fractions.length
    ? fractions.reduce((a, b) => a + b, 0) / fractions.length
    : null;
  const belowFull = fractions.filter((v) => v < 1 - 1e-9).length;
  const realizations = sectors
    .map((s) => s.priceRealization)
    .filter((v): v is number => typeof v === "number");
  const floorBoundShare = realizations.length
    ? realizations.filter((v) => v <= PRICE_REALIZATION_MIN + 1e-9).length / realizations.length
    : null;

  let supply = 0;
  let demand = 0;
  for (const c of commodities) {
    supply += num(c.globalSupply);
    demand += num(c.globalDemand);
  }
  const globalFill = demand > 0 ? supply / demand : null;
  const currentTurn = num((gs as Record<string, unknown> | null)?.["currentTurn"]);
  const maxHistTurn = history.reduce((m, h) => Math.max(m, num(h.turn)), currentTurn);
  const histFrom = Math.max(0, maxHistTurn - (TRAILING_TURNS - 1));
  const windowHist = history.filter((h) => num(h.turn) >= histFrom);
  const perTurn = new Map<number, { s: number; d: number }>();
  for (const h of windowHist) {
    const t = num(h.turn);
    const slot = perTurn.get(t) ?? { s: 0, d: 0 };
    slot.s += num(h.globalSupply);
    slot.d += num(h.globalDemand);
    perTurn.set(t, slot);
  }
  const fills = [...perTurn.values()].filter((v) => v.d > 0).map((v) => v.s / v.d);
  const trailingMeanGlobalFill = fills.length
    ? fills.reduce((a, b) => a + b, 0) / fills.length
    : null;

  let subscribedSum = 0;
  let subscribedWeight = 0;
  let holderlessCount = 0;
  for (const b of bonds) {
    // totalIssued is a face-value AMOUNT, publicFloat a UNIT count:
    // convert via the canonical per-unit face value before dividing.
    const totalUnits = BOND_UNIT_FACE_VALUE > 0 ? num(b.totalIssued) / BOND_UNIT_FACE_VALUE : 0;
    if (totalUnits > 0) {
      subscribedSum += 1 - num(b.publicFloat) / totalUnits;
      subscribedWeight += 1;
    }
    const holders = Array.isArray(b.holders) ? b.holders : [];
    const heldUnits = holders.reduce((s: number, h: { units?: unknown }) => s + num(h.units), 0);
    const qeUnits = num(b.centralBankHoldings);
    const qeRatio = typeof b.qeSupportRatio === "number" ? b.qeSupportRatio : 0;
    if (heldUnits <= 0 && qeUnits <= 0 && !(qeRatio > 0)) holderlessCount += 1;
  }

  const byStatus = new Map<string, number>();
  let listedSum = 0;
  let remainingSum = 0;
  for (const l of listings) {
    const status = str(l.status);
    byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    if (l.status === "open") {
      listedSum += num(l.sharesListed);
      remainingSum += num(l.sharesRemaining);
    }
  }
  return {
    available: true,
    note: "Floor-bound = priceRealization at PRICE_REALIZATION_MIN (0.7). Bond subscribed share = 1 - publicFloat/(totalIssued/BOND_UNIT_FACE_VALUE). Holderless = no holder units and no central-bank QE support. Trailing fill is an unweighted mean of per-turn fills. Listing taken share over open shareListings only.",
    sectorsExamined: sectors.length,
    meanSoldFraction: meanSold,
    belowFullClearingShare: fractions.length ? belowFull / fractions.length : 0,
    floorBoundShare,
    globalFill,
    trailingMeanGlobalFill,
    bonds: {
      examined: bonds.length,
      meanSubscribedShare: subscribedWeight ? subscribedSum / subscribedWeight : null,
      holderlessCount,
      holderlessShare: bonds.length ? holderlessCount / bonds.length : 0,
    },
    listings: {
      byStatus: [...byStatus.entries()]
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => a.status.localeCompare(b.status)),
      openTakenShare: listedSum > 0 ? 1 - remainingSum / listedSum : null,
    },
  };
}

/**
 * Top-level post-run collector. Never throws: each section degrades to its
 * zeroed shape with a note, so a telemetry bug can never fail an
 * already-completed run's metrics step.
 */
export async function collectEconomyTelemetry(db: Db): Promise<EconomyTelemetry> {
  const gs = await db
    .collection("gameState")
    .findOne({ _id: "current" as never })
    .catch(() => null);
  const currentTurn = num((gs as Record<string, unknown> | null)?.["currentTurn"]);

  const [reconciliation, funds, corpHealth, eraCosts, coverage, market] = await Promise.all([
    collectReconciliation(db).catch((e) => emptyReconciliation(`Collector failed: ${String(e)}`)),
    collectFunds(db, currentTurn).catch((e) => emptyFunds(`Collector failed: ${String(e)}`)),
    collectCorpHealth(db).catch((e) => emptyCorpHealth(`Collector failed: ${String(e)}`)),
    collectEraCosts(db).catch(
      (e) => emptyEconomyTelemetry(`Collector failed: ${String(e)}`).eraCosts
    ),
    collectCoverage(db).catch((e) => emptyCoverage(`Collector failed: ${String(e)}`)),
    collectMarket(db).catch((e) => emptyMarket(`Collector failed: ${String(e)}`)),
  ]);
  return { reconciliation, funds, corpHealth, eraCosts, coverage, market };
}

export function emptyEconomyTelemetry(note: string): EconomyTelemetry {
  return {
    reconciliation: emptyReconciliation(note),
    funds: emptyFunds(note),
    corpHealth: emptyCorpHealth(note),
    eraCosts: {
      available: false,
      note,
      preset: "unknown",
      startingYear: null,
      currentYear: null,
      flags: { campaignEraPriceLevelEnabled: { requested: null, available: false } },
      referenceCosts: {
        actionPoints: { campaign: [], advertise: [], donorBuild: [] },
        fundsAtNationalAverageGdp: { campaign: [], advertise: 0, donorBuildL25: 0 },
      },
    },
    coverage: emptyCoverage(note),
    market: emptyMarket(note),
  };
}
