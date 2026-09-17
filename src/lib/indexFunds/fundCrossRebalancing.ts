/**
 * Cross-fund rebalancing market.
 *
 * After public-float absorption, funds that are overweight a constituent can
 * sell shares directly to funds that are underweight the same constituent.
 * Cash moves between funds; no issuer treasury or public float is touched.
 */

import type { ClientSession, Collection, Db, ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { Corporation, IndexFund } from "@/lib/db/types";
import { resolveShareExecutionPrice } from "@/lib/corporations/marketExecution";
import { convertLocalPriceToAnchor } from "@/lib/indexFunds/fundHoldingsValuation";
import { computeHoldingsValueAnchor } from "@/lib/indexFunds/fundAllocation";
import { INDEX_FUND_MAX_EQUITY_ALLOCATION } from "@/lib/indexFunds/unitAccounting";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  claimMoneyFlowReceipt,
  deriveMoneyFlowKey,
  failMoneyFlowReceipt,
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  type MoneyFlowReceipt,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import {
  applyFundCrossTransferSpend,
  buildFundCrossTransferFingerprint,
  fireCrossTransferPostCommit,
  FUND_CROSS_TRANSFER_BUYER,
  FUND_CROSS_TRANSFER_CASH,
  FUND_CROSS_TRANSFER_SELLER,
  type FundCrossTransferOutcome,
} from "@/lib/indexFunds/fundCrossTransferSpend";

// Holding-image formulas live with the keyed cross-transfer primitive so the
// pass planner and the primitive steps share one definition; re-exported here
// for the historical import path.
export {
  updateHoldingAfterPurchase,
  updateHoldingAfterSale,
} from "@/lib/indexFunds/fundCrossTransferSpend";

// ── Types ─────────────────────────────────────────────────────────────────

export type CrossRebalanceCorp = Pick<
  Corporation,
  | "_id"
  | "sharePrice"
  | "fundamentalSharePrice"
  | "totalShares"
  | "publicFloat"
  | "liquidCurrencyCode"
>;

export type CrossRebalanceFund = Pick<
  IndexFund,
  | "_id"
  | "name"
  | "anchorCurrencyCode"
  | "status"
  | "cashAnchor"
  | "holdings"
  | "targetConstituents"
  | "bondAllocations"
>;

export type PlannedCrossTransfer = {
  corporationId: ObjectId;
  sellerFundId: ObjectId;
  buyerFundId: ObjectId;
  shares: number;
  pricePerShareAnchor: number;
  valueAnchor: number;
};

export type CrossRebalanceResult = {
  transfers: number;
  sharesTransferred: number;
  valueTransferred: number;
  errors: string[];
};

type RebalanceParticipant = {
  fundId: ObjectId;
  fundName: string;
  anchorCurrencyCode: CurrencyCode;
  shares: number;
  priceAnchor: number;
  targetWeight: number;
  totalBackingAnchor: number;
  holdingsValueAnchor: number;
  cashAnchor: number;
  maxEquityValueAnchor: number;
  driftShares: number;
};

// ── Planning ──────────────────────────────────────────────────────────────

export function planFundCrossRebalancing(input: {
  funds: CrossRebalanceFund[];
  corps: CrossRebalanceCorp[];
  exchangeRates: Partial<Record<CurrencyCode, number>>;
  bondPrincipalByFundId?: Map<string, number>;
  minTransferShares?: number;
}): PlannedCrossTransfer[] {
  const plans: PlannedCrossTransfer[] = [];
  const bondPrincipalByFundId = input.bondPrincipalByFundId ?? new Map<string, number>();

  // Fund-level resources are shared across every corp in this pass: a buyer
  // fund's cash and its equity-allocation headroom (cap on TOTAL equity) are
  // consumed cumulatively as it buys different corps' shares. Track them per
  // fund — in anchor VALUE so they're comparable across corps priced
  // differently — so the plan can't over-commit cash or breach
  // INDEX_FUND_MAX_EQUITY_ALLOCATION across the whole pass. (Sells are not
  // credited back within a pass — that only keeps us more conservative.)
  const fundCashRemaining = new Map<string, number>();
  const fundEquityRemaining = new Map<string, number>();

  for (const corp of input.corps) {
    const executionPrice = resolveShareExecutionPrice(corp);
    if (!Number.isFinite(executionPrice) || executionPrice <= 0) continue;

    const participants = buildCorpParticipants({
      corp,
      funds: input.funds,
      exchangeRates: input.exchangeRates,
      bondPrincipalByFundId,
    });
    if (participants.length === 0) continue;

    // Seed the fund-level resource trackers the first time we see each fund
    // (its cash and equity headroom are the same fund total regardless of corp).
    for (const p of participants) {
      const key = p.fundId.toString();
      if (!fundCashRemaining.has(key)) fundCashRemaining.set(key, p.cashAnchor);
      if (!fundEquityRemaining.has(key)) {
        fundEquityRemaining.set(key, Math.max(0, p.maxEquityValueAnchor - p.holdingsValueAnchor));
      }
    }

    // Only match funds denominated in the same anchor currency so cash and
    // share value move 1:1 without introducing FX accounting in this pass.
    const byAnchor = groupByAnchor(participants);

    for (const group of byAnchor.values()) {
      const sellers = group
        .filter((p) => p.driftShares > 0)
        .sort((a, b) => b.driftShares - a.driftShares);
      const buyers = group
        .filter((p) => p.driftShares < 0)
        .sort((a, b) => a.driftShares - b.driftShares);
      if (sellers.length === 0 || buyers.length === 0) continue;

      // Deficit is corp-specific drift, so it resets per corp/group.
      const buyerDeficitShares = new Map<string, number>();
      for (const buyer of buyers) {
        buyerDeficitShares.set(buyer.fundId.toString(), -buyer.driftShares);
      }

      for (const seller of sellers) {
        let sellerRemaining = seller.driftShares;

        for (const buyer of buyers) {
          if (sellerRemaining <= 0) break;

          const key = buyer.fundId.toString();
          const deficitShares = buyerDeficitShares.get(key) ?? 0;
          if (deficitShares <= 0) continue;

          const cashRemainingShares = (fundCashRemaining.get(key) ?? 0) / buyer.priceAnchor;
          const equityRemainingShares = (fundEquityRemaining.get(key) ?? 0) / buyer.priceAnchor;

          const transferable = Math.min(
            sellerRemaining,
            deficitShares,
            cashRemainingShares,
            equityRemainingShares
          );
          const shares = Math.max(0, Math.floor(transferable));
          if (shares < (input.minTransferShares ?? 1)) continue;

          const valueAnchor = shares * buyer.priceAnchor;
          plans.push({
            corporationId: corp._id,
            sellerFundId: seller.fundId,
            buyerFundId: buyer.fundId,
            shares,
            pricePerShareAnchor: buyer.priceAnchor,
            valueAnchor,
          });

          sellerRemaining -= shares;
          buyerDeficitShares.set(key, deficitShares - shares);
          fundCashRemaining.set(key, (fundCashRemaining.get(key) ?? 0) - valueAnchor);
          fundEquityRemaining.set(key, (fundEquityRemaining.get(key) ?? 0) - valueAnchor);
        }
      }
    }
  }

  return plans;
}

function buildCorpParticipants(input: {
  corp: CrossRebalanceCorp;
  funds: CrossRebalanceFund[];
  exchangeRates: Partial<Record<CurrencyCode, number>>;
  bondPrincipalByFundId: Map<string, number>;
}): RebalanceParticipant[] {
  const { corp, funds, exchangeRates, bondPrincipalByFundId } = input;
  const executionPrice = resolveShareExecutionPrice(corp);
  if (!Number.isFinite(executionPrice) || executionPrice <= 0) return [];

  const participants: RebalanceParticipant[] = [];

  for (const fund of funds) {
    if (fund.status !== "active") continue;

    const priceAnchor = convertLocalPriceToAnchor(
      executionPrice,
      corp.liquidCurrencyCode,
      exchangeRates
    );
    if (priceAnchor === null || priceAnchor <= 0) continue;

    const holding = fund.holdings.find((h) => h.corporationId.toString() === corp._id.toString());
    const target = fund.targetConstituents.find(
      (t) => t.corporationId.toString() === corp._id.toString()
    );

    const shares = holding?.shares ?? 0;
    const targetWeight = target?.targetWeight ?? 0;
    const holdingsValueAnchor = computeHoldingsValueAnchor(fund);
    const bondPrincipalAnchor = bondPrincipalByFundId.get(fund._id.toString()) ?? 0;
    const totalBackingAnchor = fund.cashAnchor + holdingsValueAnchor + bondPrincipalAnchor;

    if (totalBackingAnchor <= 0) continue;

    const maxEquityValueAnchor = totalBackingAnchor * INDEX_FUND_MAX_EQUITY_ALLOCATION;
    const targetShares = (totalBackingAnchor * targetWeight) / priceAnchor;
    const driftShares = shares - targetShares;

    // Skip funds that are effectively at target (tiny drift from rounding).
    if (Math.abs(driftShares) < 1e-9) continue;

    participants.push({
      fundId: fund._id,
      fundName: fund.name,
      anchorCurrencyCode: fund.anchorCurrencyCode,
      shares,
      priceAnchor,
      targetWeight,
      totalBackingAnchor,
      holdingsValueAnchor,
      cashAnchor: fund.cashAnchor,
      maxEquityValueAnchor,
      driftShares,
    });
  }

  return participants;
}

function groupByAnchor(
  participants: RebalanceParticipant[]
): Map<CurrencyCode, RebalanceParticipant[]> {
  const map = new Map<CurrencyCode, RebalanceParticipant[]>();
  for (const p of participants) {
    const list = map.get(p.anchorCurrencyCode) ?? [];
    list.push(p);
    map.set(p.anchorCurrencyCode, list);
  }
  return map;
}

// ── Execution: crash-safe pass driver ───────────────────────────────────────

/**
 * Deterministic parent key for one turn's cross-fund pass: the cron runs at
 * most one cross-fund market per turn, so the turn names the attempt. A
 * same-turn retry (crash recovery, same-turn double-fire) reuses it and
 * resumes instead of rebalancing twice.
 */
export function buildFundCrossRebalancePassKey(turn: number): string {
  return `indexfund-cross-rebalance:turn:${turn}`;
}

/**
 * Planner context the pass pins before mutable work. The cron already holds
 * every row the planner read (fund snapshots with targets, corp rows, the
 * rate table); handing them here lets the driver pin the complete
 * participant set, targets, ordering, computed quantities, currencies, and
 * rates without re-reading — and a retry replays the pins instead of
 * re-deriving them from post-transfer state.
 */
export interface CrossRebalancePassContext {
  funds: CrossRebalanceFund[];
  corps: CrossRebalanceCorp[];
  exchangeRates: Partial<Record<CurrencyCode, number>>;
}

export type CrossPassLegStatus = "pending" | "completed" | "skipped" | "failed";

interface CrossPassLeg {
  corporationIdHex: string;
  sellerFundIdHex: string;
  buyerFundIdHex: string;
  sellerFundName: string;
  buyerFundName: string;
  shares: number;
  pricePerShareAnchor: number;
  valueAnchor: number;
  executionPriceLocal: number;
  anchorCurrencyCode: CurrencyCode;
  corpCurrencyCode?: string;
  sellerAvgCostAnchor: number | null;
  childKey: string;
  status: CrossPassLegStatus;
  error?: string;
  outcome?: FundCrossTransferOutcome;
}

interface CrossPassStoredPlan {
  version: 1;
  turn: number;
  nowIso: string;
  funds: Array<{
    fundIdHex: string;
    name: string;
    anchorCurrencyCode: CurrencyCode;
    status: string;
    targets: Array<{ corporationIdHex: string; targetWeight: number }>;
  }>;
  corps: Array<{ corporationIdHex: string; liquidCurrencyCode?: CurrencyCode }>;
  exchangeRates: Record<string, number>;
  legs: CrossPassLeg[];
  outcome?: CrossRebalanceResult;
}

/** Receipt rows carry the pass resume plan under this field (never in the shared type). */
type CrossPassReceipt = MoneyFlowReceipt & { fundCrossRebalancePassPlan?: unknown };

function isCrossPassPlan(value: unknown): value is CrossPassStoredPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return plan.version === 1 && typeof plan.turn === "number" && Array.isArray(plan.legs);
}

function isCrossPassOutcome(value: unknown): value is CrossRebalanceResult {
  if (!value || typeof value !== "object") return false;
  const outcome = value as Record<string, unknown>;
  return (
    typeof outcome.transfers === "number" &&
    typeof outcome.sharesTransferred === "number" &&
    typeof outcome.valueTransferred === "number" &&
    Array.isArray(outcome.errors)
  );
}

/**
 * Deterministic fingerprint for one cross-fund pass. Covers the turn and the
 * participant fund set — the identity of the market — but NOT the legs: the
 * legs are the stored payload, and each transfer still carries its own
 * fingerprint under its child key, so a child key reused for different
 * figures fails closed there. A parent key reused for a different fund set
 * is a different market and stays a `MoneyFlowKeyConflictError`.
 */
function buildCrossPassFingerprint(turn: number, fundIdHexes: string[]): string {
  return `fund-cross-rebalance-pass:turn:${turn}:funds:${[...fundIdHexes].sort().join(",")}`;
}

function isSkipCrossError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return (
    message.startsWith(FUND_CROSS_TRANSFER_SELLER) ||
    message.startsWith(FUND_CROSS_TRANSFER_BUYER) ||
    message.startsWith(FUND_CROSS_TRANSFER_CASH)
  );
}

async function readChildReceiptError(
  db: Db,
  childKey: string,
  sessionOpts: { session?: ClientSession }
): Promise<string | null> {
  try {
    const receipts = await getMoneyFlowReceiptsCollection(db);
    const existing = await receipts.findOne(
      { _id: childKey } as never,
      sessionOpts.session ? { session: sessionOpts.session } : {}
    );
    return typeof existing?.error === "string" ? existing.error : null;
  } catch {
    return null;
  }
}

/**
 * Resolve every pinned figure for one planned transfer before any mutable
 * work runs. Planner context wins when present; otherwise the pins come from
 * live reads taken here, still before the first transfer applies. A leg
 * whose fund, corp, or price is gone names a skip exactly like the legacy
 * pre-checks did (silent, not an error).
 */
async function pinCrossLeg(
  db: Db,
  parentKey: string,
  plan: PlannedCrossTransfer,
  context: CrossRebalancePassContext | undefined
): Promise<CrossPassLeg> {
  const base = {
    corporationIdHex: plan.corporationId.toHexString(),
    sellerFundIdHex: plan.sellerFundId.toHexString(),
    buyerFundIdHex: plan.buyerFundId.toHexString(),
    shares: plan.shares,
    pricePerShareAnchor: plan.pricePerShareAnchor,
    valueAnchor: plan.valueAnchor,
    childKey: deriveMoneyFlowKey(
      parentKey,
      "xfund",
      plan.corporationId.toHexString(),
      plan.sellerFundId.toHexString(),
      plan.buyerFundId.toHexString(),
      String(plan.shares)
    ),
    status: "pending" as CrossPassLegStatus,
  };
  const skip = (leg: Omit<CrossPassLeg, "status">): CrossPassLeg => ({ ...leg, status: "skipped" });

  const contextFund = (id: string): CrossRebalanceFund | undefined =>
    context?.funds.find((f) => f._id.toString() === id);
  const sellerSnapshot = contextFund(base.sellerFundIdHex);
  const buyerSnapshot = contextFund(base.buyerFundIdHex);
  const corpSnapshot = context?.corps.find(
    (c) => c._id.toString() === base.corporationIdHex
  );

  let sellerName = sellerSnapshot?.name;
  let buyerName = buyerSnapshot?.name;
  let sellerAvg: number | null | undefined = sellerSnapshot?.holdings.find(
    (h) => h.corporationId.toString() === base.corporationIdHex
  )?.avgCostPerShareAnchor;
  let anchor = sellerSnapshot?.anchorCurrencyCode ?? buyerSnapshot?.anchorCurrencyCode;
  let liquidCurrency: CurrencyCode | undefined = corpSnapshot?.liquidCurrencyCode ?? undefined;
  let executionPriceLocal: number | undefined = corpSnapshot
    ? resolveShareExecutionPrice(corpSnapshot)
    : undefined;

  if (
    sellerName === undefined ||
    buyerName === undefined ||
    sellerAvg === undefined ||
    anchor === undefined ||
    executionPriceLocal === undefined
  ) {
    const funds = db.collection<IndexFund>("indexFunds");
    const [sellerLive, buyerLive] = await Promise.all([
      sellerName === undefined || sellerAvg === undefined || anchor === undefined
        ? funds.findOne(
            { _id: plan.sellerFundId } as never,
            { projection: { name: 1, anchorCurrencyCode: 1, holdings: 1 } }
          )
        : null,
      buyerName === undefined || anchor === undefined
        ? funds.findOne(
            { _id: plan.buyerFundId } as never,
            { projection: { name: 1, anchorCurrencyCode: 1 } }
          )
        : null,
    ]);
    if (sellerName === undefined) sellerName = sellerLive?.name;
    if (buyerName === undefined) buyerName = buyerLive?.name;
    if (anchor === undefined)
      anchor = sellerLive?.anchorCurrencyCode ?? buyerLive?.anchorCurrencyCode;
    if (sellerAvg === undefined) {
      const holding = (sellerLive?.holdings as IndexFund["holdings"] | undefined)?.find(
        (h) => h.corporationId.toString() === base.corporationIdHex
      );
      sellerAvg = holding?.avgCostPerShareAnchor ?? null;
    }
    if (executionPriceLocal === undefined) {
      const corpLive = await db
        .collection<Corporation>("corporations")
        .findOne(
          { _id: plan.corporationId } as never,
          { projection: { sharePrice: 1, fundamentalSharePrice: 1, liquidCurrencyCode: 1 } }
        );
      if (!corpLive) {
        return skip({
          ...base,
          sellerFundName: sellerName ?? base.sellerFundIdHex,
          buyerFundName: buyerName ?? base.buyerFundIdHex,
          executionPriceLocal: 0,
          anchorCurrencyCode: (anchor ?? "USD") as CurrencyCode,
          sellerAvgCostAnchor: null,
        });
      }
      executionPriceLocal = resolveShareExecutionPrice(corpLive);
      liquidCurrency = corpLive.liquidCurrencyCode;
    }
  }

  if (!sellerName || !buyerName || !anchor) {
    return skip({
      ...base,
      sellerFundName: sellerName ?? base.sellerFundIdHex,
      buyerFundName: buyerName ?? base.buyerFundIdHex,
      executionPriceLocal: executionPriceLocal ?? 0,
      anchorCurrencyCode: (anchor ?? "USD") as CurrencyCode,
      sellerAvgCostAnchor: null,
    });
  }
  if (!Number.isFinite(executionPriceLocal) || (executionPriceLocal as number) <= 0) {
    return skip({
      ...base,
      sellerFundName,
      buyerFundName,
      executionPriceLocal: 0,
      anchorCurrencyCode: anchor,
      sellerAvgCostAnchor: null,
    });
  }
  return {
    ...base,
    sellerFundName,
    buyerFundName,
    executionPriceLocal: executionPriceLocal as number,
    anchorCurrencyCode: anchor,
    ...(liquidCurrency !== undefined ? { corpCurrencyCode: liquidCurrency as string } : {}),
    sellerAvgCostAnchor: sellerAvg ?? null,
  };
}

/** Run one pinned leg through the primitive under its child key. */
async function applyCrossLeg(
  db: Db,
  leg: CrossPassLeg,
  currentTurn: number,
  sessionOpts: { session?: ClientSession }
): Promise<{ duplicate: boolean; outcome: FundCrossTransferOutcome }> {
  const result = await applyFundCrossTransferSpend(
    db,
    {
      sellerFundId: new ObjectId(leg.sellerFundIdHex),
      buyerFundId: new ObjectId(leg.buyerFundIdHex),
      corpId: new ObjectId(leg.corporationIdHex),
      shares: leg.shares,
      pricePerShareAnchor: leg.pricePerShareAnchor,
      valueAnchor: leg.valueAnchor,
      executionPriceLocal: leg.executionPriceLocal,
      sellerFundName: leg.sellerFundName,
      buyerFundName: leg.buyerFundName,
      anchorCurrencyCode: leg.anchorCurrencyCode,
      ...(leg.corpCurrencyCode !== undefined ? { corpCurrencyCode: leg.corpCurrencyCode } : {}),
      sellerAvgCostAnchor: leg.sellerAvgCostAnchor,
      turn: currentTurn,
      fingerprint: buildFundCrossTransferFingerprint({
        sellerFundId: new ObjectId(leg.sellerFundIdHex),
        buyerFundId: new ObjectId(leg.buyerFundIdHex),
        corpId: new ObjectId(leg.corporationIdHex),
        shares: leg.shares,
        pricePerShareAnchor: leg.pricePerShareAnchor,
        valueAnchor: leg.valueAnchor,
        executionPriceLocal: leg.executionPriceLocal,
        turn: currentTurn,
      }),
      idempotencyKey: leg.childKey,
    },
    sessionOpts.session ? { session: sessionOpts.session } : {}
  );
  if (!result.duplicate) {
    await fireCrossTransferPostCommit(
      db,
      {
        corpId: new ObjectId(leg.corporationIdHex),
        sellerFundId: new ObjectId(leg.sellerFundIdHex),
        sellerFundName: leg.sellerFundName,
        buyerFundName: leg.buyerFundName,
        shares: leg.shares,
        pricePerShareAnchor: leg.pricePerShareAnchor,
        ...(leg.corpCurrencyCode !== undefined ? { corpCurrencyCode: leg.corpCurrencyCode } : {}),
        turn: currentTurn,
      },
      sessionOpts
    );
  }
  return result;
}

/**
 * Execute a planned cross-fund market so a retry cannot repeat completed
 * legs, rebalance one fund twice, use changed targets midway, or strand
 * partially applied state (issue #1672).
 *
 * Crash-safe pass driver over the `applyFundCrossTransferSpend` primitive:
 * the pass pins the complete participant set, targets, ordering, computed
 * quantities, currencies/rates, and child operation keys on a parent receipt
 * before the first transfer, then runs each leg through the keyed primitive
 * under its child key. A same-key retry replays the stored legs (completed
 * legs tally from the stored outcome without re-invoking, pending legs
 * reconcile through their child receipts) instead of recomputing from
 * post-transfer state, so a resumed market cannot repeat a landed transfer
 * or price one from moved cash. A lost seller, buyer, or cash race skips
 * the leg exactly like the legacy guarded writes did; anything later lands
 * in `errors` and the pass continues with the next leg, exactly like the
 * legacy per-transfer catch did.
 *
 * There is no pass-level orphan driver (like buys/sales, no intent row
 * exists to strand): an unretried partial stays exactly as the crash left
 * it, and the next turn's pass runs under a new key.
 */
export async function executeFundCrossRebalancing(
  db: Db,
  plans: PlannedCrossTransfer[],
  currentTurn: number,
  options?: {
    session?: ClientSession;
    idempotencyKey?: string;
    context?: CrossRebalancePassContext;
  }
): Promise<CrossRebalanceResult> {
  const zeros: CrossRebalanceResult = {
    transfers: 0,
    sharesTransferred: 0,
    valueTransferred: 0,
    errors: [],
  };
  if (plans.length === 0) return zeros;

  const parentKey =
    options?.idempotencyKey !== undefined
      ? options.idempotencyKey
      : buildFundCrossRebalancePassKey(currentTurn);
  if (parentKey.length === 0 || parentKey.length > 128) {
    throw new RangeError("Cross-fund pass idempotency key must be 1-128 characters");
  }

  const contextFunds = options?.context?.funds;
  const fingerprintFunds =
    contextFunds !== undefined && contextFunds.length > 0
      ? contextFunds.map((f) => f._id.toString())
      : [...new Set(plans.flatMap((p) => [p.sellerFundId.toString(), p.buyerFundId.toString()]))];
  const fingerprint = buildCrossPassFingerprint(currentTurn, fingerprintFunds);

  // Pin every leg figure once, before any mutable write. A same-key retry
  // replays these pins (never a fresh plan over post-transfer state).
  const liveLegs: CrossPassLeg[] = [];
  for (const plan of plans) {
    liveLegs.push(await pinCrossLeg(db, parentKey, plan, options?.context));
  }

  const snapshotFunds = (options?.context?.funds ?? []).map((f) => ({
    fundIdHex: f._id.toString(),
    name: f.name,
    anchorCurrencyCode: f.anchorCurrencyCode,
    status: f.status,
    targets: f.targetConstituents.map((t) => ({
      corporationIdHex: t.corporationId.toString(),
      targetWeight: t.targetWeight,
    })),
  }));
  const snapshotCorps = (options?.context?.corps ?? []).map((c) => ({
    corporationIdHex: c._id.toString(),
    ...(c.liquidCurrencyCode !== undefined ? { liquidCurrencyCode: c.liquidCurrencyCode } : {}),
  }));
  const snapshotRates: Record<string, number> = {};
  for (const [code, rate] of Object.entries(options?.context?.exchangeRates ?? {})) {
    if (typeof rate === "number" && Number.isFinite(rate)) snapshotRates[code] = rate;
  }

  const runPass = async (session?: ClientSession) => {
    const sessionOpts = session ? { session } : {};
    const receipts = await getMoneyFlowReceiptsCollection(db);
    const receiptCollection = receipts as unknown as Collection<CrossPassReceipt>;
    let claim: Awaited<ReturnType<typeof claimMoneyFlowReceipt>>;
    try {
      claim = await claimMoneyFlowReceipt(receipts, parentKey, fingerprint, sessionOpts);
    } catch (err) {
      if (!(err instanceof MoneyFlowKeyConflictError)) throw err;
      // Same key, different fund set: a genuinely different market reusing
      // the key, not a post-crash remainder. Fail closed.
      throw err;
    }
    if (claim === "duplicate") {
      const existing = await receiptCollection.findOne({ _id: parentKey }, sessionOpts);
      const stored = existing?.fundCrossRebalancePassPlan;
      if (!isCrossPassPlan(stored) || !isCrossPassOutcome(stored.outcome)) {
        throw new Error("MONEY_FLOW_RECEIPT_LOST");
      }
      return { ...stored.outcome, errors: [...stored.outcome.errors] };
    }
    let legsToRun = liveLegs;
    if (claim === "in-progress") {
      // Same fingerprint, so the live legs name the same market, but the
      // pass runs the STORED legs when they exist: post-transfer state would
      // replan different sizes and strand the landed legs' cash outside the
      // remaining market. No stored plan means the crash landed between the
      // claim insert and the plan write below (nothing applied yet), so the
      // live legs under the stored fingerprint are exact.
      const existing = await receiptCollection.findOne({ _id: parentKey }, sessionOpts);
      const stored = existing?.fundCrossRebalancePassPlan;
      if (isCrossPassPlan(stored)) {
        legsToRun = stored.legs;
      }
    } else {
      // A fresh claim owns the pass. Persist the leg sequence before the
      // first transfer: a crash from here on replays this exact sequence
      // under the same key.
      try {
        await receiptCollection.updateOne(
          { _id: parentKey },
          {
            $set: {
              fundCrossRebalancePassPlan: {
                version: 1,
                turn: currentTurn,
                nowIso: new Date().toISOString(),
                funds: snapshotFunds,
                corps: snapshotCorps,
                exchangeRates: snapshotRates,
                legs: liveLegs,
              } satisfies CrossPassStoredPlan,
              updatedAt: new Date(),
            },
          },
          sessionOpts
        );
      } catch (planError) {
        await failMoneyFlowReceipt(
          receipts,
          parentKey,
          `${FUND_CROSS_TRANSFER_TX}:pass-plan-store`,
          sessionOpts
        );
        throw planError;
      }
    }

    const settleLeg = async (
      index: number,
      status: CrossPassLegStatus,
      error?: string,
      outcome?: FundCrossTransferOutcome
    ): Promise<void> => {
      const leg = legsToRun[index];
      if (!leg) return;
      leg.status = status;
      if (error !== undefined) leg.error = error;
      else delete leg.error;
      if (outcome !== undefined) leg.outcome = { ...outcome };
      await receiptCollection.updateOne(
        { _id: parentKey },
        {
          $set: {
            [`fundCrossRebalancePassPlan.legs.${index}.status`]: status,
            ...(error !== undefined
              ? { [`fundCrossRebalancePassPlan.legs.${index}.error`]: error }
              : {}),
            ...(outcome !== undefined
              ? { [`fundCrossRebalancePassPlan.legs.${index}.outcome`]: { ...outcome } }
              : {}),
            updatedAt: new Date(),
          },
        },
        sessionOpts
      );
    };

    let transfers = 0;
    let sharesTransferred = 0;
    let valueTransferred = 0;
    for (let index = 0; index < legsToRun.length; index += 1) {
      const leg = legsToRun[index]!;
      if (leg.status === "completed") {
        transfers += 1;
        sharesTransferred += leg.outcome?.sharesTransferred ?? leg.shares;
        valueTransferred += leg.outcome?.valueTransferred ?? leg.valueAnchor;
        continue;
      }
      if (leg.status === "skipped") continue;
      if (leg.status === "failed" && leg.error !== undefined) {
        // A leg that already failed and settled keeps its verdict on resume:
        // its child receipt is terminal, so re-driving would only re-report
        // the same failure. Preserve the legacy continue-with-next-leg.
        continue;
      }
      let result: Awaited<ReturnType<typeof applyCrossLeg>>;
      try {
        result = await applyCrossLeg(db, leg, currentTurn, sessionOpts);
      } catch (err) {
        if (isSkipCrossError(err)) {
          await settleLeg(index, "skipped");
          continue;
        }
        if (err instanceof MoneyFlowTerminalError) {
          const childError = await readChildReceiptError(db, leg.childKey, sessionOpts);
          if (childError !== null && isSkipCrossError(new Error(childError))) {
            await settleLeg(index, "skipped");
            continue;
          }
          const message =
            `Cross-rebalance ${leg.corporationIdHex} ` +
            `${leg.sellerFundIdHex}→${leg.buyerFundIdHex}: ${err instanceof Error ? err.message : String(err)}`;
          await settleLeg(index, "failed", message);
          continue;
        }
        const message =
          `Cross-rebalance ${leg.corporationIdHex} ` +
          `${leg.sellerFundIdHex}→${leg.buyerFundIdHex}: ${err instanceof Error ? err.message : String(err)}`;
        await settleLeg(index, "failed", message);
        continue;
      }
      await settleLeg(index, "completed", undefined, result.outcome);
      transfers += 1;
      sharesTransferred += result.outcome.sharesTransferred;
      valueTransferred += result.outcome.valueTransferred;
    }

    // One atomic settle: the outcome lands with the `completed` status, so
    // no crash window separates them. Errors rebuild from the per-leg
    // verdicts, so a resumed settle reports identically.
    const storedPlan = await receiptCollection.findOne({ _id: parentKey }, sessionOpts);
    const settledLegs = isCrossPassPlan(storedPlan?.fundCrossRebalancePassPlan)
      ? storedPlan.fundCrossRebalancePassPlan.legs
      : legsToRun;
    const outcome: CrossRebalanceResult = {
      transfers,
      sharesTransferred,
      valueTransferred,
      errors: settledLegs.flatMap((leg) =>
        leg.status === "failed" && leg.error !== undefined ? [leg.error] : []
      ),
    };
    await receiptCollection.updateOne(
      { _id: parentKey },
      {
        $set: {
          status: "completed",
          fundCrossRebalancePassPlan: {
            version: 1,
            turn: currentTurn,
            nowIso: new Date().toISOString(),
            funds: snapshotFunds,
            corps: snapshotCorps,
            exchangeRates: snapshotRates,
            legs: settledLegs,
            outcome,
          } satisfies CrossPassStoredPlan,
          updatedAt: new Date(),
        },
      },
      sessionOpts
    );
    return outcome;
  };

  // Join the caller's transaction when one is in flight; otherwise manage our
  // own. Never open a nested transaction around an outer session.
  if (options?.session) return runPass(options.session);
  return runWithOptionalTransaction(
    async (session) => runPass(session ?? undefined),
    async () => runPass()
  );
}
