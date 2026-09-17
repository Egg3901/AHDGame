import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { ClientSession, Collection, Db, Filter } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  deriveMoneyFlowKey,
  failMoneyFlowReceipt,
  keyedInsertId,
  makeInsertStep,
  makeLegStep,
  MoneyFlowKeyConflictError,
  runMoneyFlowSteps,
  type MoneyFlowAccount,
  type MoneyFlowLegOutcome,
  type MoneyFlowOptions,
  type MoneyFlowReceipt,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { recordShareTrade } from "@/lib/corporations/shareTradeHistory";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { IndexFundHolding, IndexFundTransaction, Shareholder } from "@/lib/db/types";

/** Seller cap-table debit lost its race (shares moved) or the corp row went: caller skips. */
export const FUND_CROSS_TRANSFER_SELLER = "FUND_CROSS_TRANSFER_SELLER";
/** Buyer cap-table credit lost its race: prefix compensated, caller skips. */
export const FUND_CROSS_TRANSFER_BUYER = "FUND_CROSS_TRANSFER_BUYER";
/** Buyer cash debit lost its race: prefix compensated, caller skips. */
export const FUND_CROSS_TRANSFER_CASH = "FUND_CROSS_TRANSFER_CASH";
/** Seller cash credit failed after money moved: prefix compensated, caller treats as pathological. */
export const FUND_CROSS_TRANSFER_SELLER_CASH = "FUND_CROSS_TRANSFER_SELLER_CASH";
/** Fund holdings write failed after money moved: prefix compensated, caller treats as pathological. */
export const FUND_CROSS_TRANSFER_HOLDINGS = "FUND_CROSS_TRANSFER_HOLDINGS";
/** Cross-fund audit-row insert failed after money moved: prefix compensated, caller retries next turn. */
export const FUND_CROSS_TRANSFER_TX = "FUND_CROSS_TRANSFER_TX";

/** Domain for the deterministic seller audit-row `_id` derived from the flow key. */
const SELL_TX_INSERT_DOMAIN = "indexfund-cross-tx-sell";
/** Domain for the deterministic buyer audit-row `_id` derived from the flow key. */
const BUY_TX_INSERT_DOMAIN = "indexfund-cross-tx-buy";

export interface FundCrossTransferSpendInput {
  sellerFundId: ObjectId;
  buyerFundId: ObjectId;
  corpId: ObjectId;
  /** Whole shares moving seller → buyer. */
  shares: number;
  /** Anchor price per share pinned by the pass planner. */
  pricePerShareAnchor: number;
  /** Anchor cash moving buyer → seller (`shares` x `pricePerShareAnchor`). */
  valueAnchor: number;
  /** Corp-local execution price, for the buyer cap-table average-cost basis. */
  executionPriceLocal: number;
  /** Fund display names, for the audit notes and trade row (pinned, replayed verbatim). */
  sellerFundName: string;
  buyerFundName: string;
  /** Anchor currency shared by both funds (the planner only matches same-anchor pairs). */
  anchorCurrencyCode: CurrencyCode;
  /** Corp liquid currency code at plan time, for the trade-history row. */
  corpCurrencyCode?: string;
  /**
   * Seller holding average at plan time. Pinned by the caller while the row
   * still exists so compensation restores the exact average even when a
   * crash-recovery retry reads post-sale holdings (row possibly gone).
   */
  sellerAvgCostAnchor: number | null;
  /** Cron turn, for keying. */
  turn: number;
  /**
   * Caller-chosen fingerprint of the intended transfer (see
   * `buildFundCrossTransferFingerprint`). A retry with the same key and
   * fingerprint reconciles the stored plan; a different fingerprint is a
   * different transfer and stays a `MoneyFlowKeyConflictError`.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key. The cross-fund pass derives one per leg
   * from its parent key so a same-pass retry resumes instead of repeating the
   * transfer. Omit to mint one: the attempt is still crash-safe within
   * itself, but a retry mints a new key and is treated as a new transfer
   * (still guarded by the atomic debits).
   */
  idempotencyKey?: string;
}

/**
 * Deterministic idempotency key for one cross-fund transfer: seller + buyer +
 * corp + turn + shares names the attempt. A same-turn retry (crash recovery,
 * same-turn double-fire) reuses it and reconciles; a recomputed
 * different-size transfer gets a new key and runs as a fresh guarded attempt.
 */
export function buildFundCrossTransferKey(
  sellerFundId: ObjectId,
  buyerFundId: ObjectId,
  corpId: ObjectId,
  turn: number,
  shares: number
): string {
  return `fund-cross-transfer:${sellerFundId.toHexString()}:${buyerFundId.toHexString()}:${corpId.toHexString()}:turn:${turn}:shares:${shares}`;
}

/**
 * Deterministic fingerprint for one cross-fund transfer attempt. Covers the
 * operation identity (funds, corp, turn) plus every pinned amount and the
 * display names, so a key reused for a different transfer fails closed
 * instead of replaying the wrong outcome.
 */
export function buildFundCrossTransferFingerprint(input: {
  sellerFundId: ObjectId;
  buyerFundId: ObjectId;
  corpId: ObjectId;
  shares: number;
  pricePerShareAnchor: number;
  valueAnchor: number;
  executionPriceLocal: number;
  turn: number;
}): string {
  const cents = (n: number): string => String(Math.round(n * 100) / 100);
  return [
    "fund-cross-transfer",
    input.sellerFundId.toHexString(),
    input.buyerFundId.toHexString(),
    input.corpId.toHexString(),
    `shares:${input.shares}`,
    `priceAnchor:${cents(input.pricePerShareAnchor)}`,
    `value:${cents(input.valueAnchor)}`,
    `execLocal:${cents(input.executionPriceLocal)}`,
    `turn:${input.turn}`,
  ].join(":");
}

/** Stored transfer numbers, written post-commit so a replay reports stably. */
export interface FundCrossTransferOutcome {
  sharesTransferred: number;
  valueTransferred: number;
}

export function isFundCrossTransferOutcome(value: unknown): value is FundCrossTransferOutcome {
  if (!value || typeof value !== "object") return false;
  const outcome = value as Record<string, unknown>;
  return (
    typeof outcome.sharesTransferred === "number" && typeof outcome.valueTransferred === "number"
  );
}

/**
 * Crash-resume plan persisted on the flow receipt right after the fresh
 * claim, before any money moves. A same-key retry after a crash rebuilds its
 * steps from THIS plan, never from the caller's live input: the pass prices
 * every transfer from live fund state, so post-crash input is computed from
 * post-debit reads and running it would repeat completed legs. Resuming the
 * stored plan keeps the cap-table moves, the cash move, the holdings writes,
 * and every compensation inverse at exactly the attempted amounts.
 */
export interface FundCrossTransferStoredPlan {
  version: 1;
  sellerFundIdHex: string;
  buyerFundIdHex: string;
  corpIdHex: string;
  shares: number;
  pricePerShareAnchor: number;
  valueAnchor: number;
  executionPriceLocal: number;
  sellerFundName: string;
  buyerFundName: string;
  anchorCurrencyCode: CurrencyCode;
  corpCurrencyCode?: string;
  sellerAvgCostAnchor: number | null;
  turn: number;
  nowIso: string;
  outcome?: FundCrossTransferOutcome;
}

function toStoredPlan(input: FundCrossTransferSpendInput, now: Date): FundCrossTransferStoredPlan {
  return {
    version: 1,
    sellerFundIdHex: input.sellerFundId.toHexString(),
    buyerFundIdHex: input.buyerFundId.toHexString(),
    corpIdHex: input.corpId.toHexString(),
    shares: input.shares,
    pricePerShareAnchor: input.pricePerShareAnchor,
    valueAnchor: input.valueAnchor,
    executionPriceLocal: input.executionPriceLocal,
    sellerFundName: input.sellerFundName,
    buyerFundName: input.buyerFundName,
    anchorCurrencyCode: input.anchorCurrencyCode,
    ...(input.corpCurrencyCode !== undefined ? { corpCurrencyCode: input.corpCurrencyCode } : {}),
    sellerAvgCostAnchor: input.sellerAvgCostAnchor,
    turn: input.turn,
    nowIso: now.toISOString(),
  };
}

function isStoredPlan(value: unknown): value is FundCrossTransferStoredPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.version === 1 &&
    typeof plan.sellerFundIdHex === "string" &&
    typeof plan.buyerFundIdHex === "string" &&
    typeof plan.corpIdHex === "string" &&
    typeof plan.shares === "number"
  );
}

/** Receipt rows carry the resume plan under this field (never in the shared type). */
type FundCrossTransferReceipt = MoneyFlowReceipt & { fundCrossTransferPlan?: unknown };

interface NormalizedCrossPlan {
  sellerFundId: ObjectId;
  buyerFundId: ObjectId;
  corpId: ObjectId;
  shares: number;
  pricePerShareAnchor: number;
  valueAnchor: number;
  executionPriceLocal: number;
  sellerFundName: string;
  buyerFundName: string;
  anchorCurrencyCode: CurrencyCode;
  corpCurrencyCode?: string;
  sellerAvgCostAnchor: number | null;
  turn: number;
  now: Date;
  outcome?: FundCrossTransferOutcome;
}

function planFromInput(live: FundCrossTransferSpendInput, now: Date): NormalizedCrossPlan {
  return {
    sellerFundId: live.sellerFundId,
    buyerFundId: live.buyerFundId,
    corpId: live.corpId,
    shares: live.shares,
    pricePerShareAnchor: live.pricePerShareAnchor,
    valueAnchor: live.valueAnchor,
    executionPriceLocal: live.executionPriceLocal,
    sellerFundName: live.sellerFundName,
    buyerFundName: live.buyerFundName,
    anchorCurrencyCode: live.anchorCurrencyCode,
    ...(live.corpCurrencyCode !== undefined ? { corpCurrencyCode: live.corpCurrencyCode } : {}),
    sellerAvgCostAnchor: live.sellerAvgCostAnchor,
    turn: live.turn,
    now,
  };
}

function planFromStored(stored: FundCrossTransferStoredPlan): NormalizedCrossPlan {
  return {
    sellerFundId: new ObjectId(stored.sellerFundIdHex),
    buyerFundId: new ObjectId(stored.buyerFundIdHex),
    corpId: new ObjectId(stored.corpIdHex),
    shares: stored.shares,
    pricePerShareAnchor: stored.pricePerShareAnchor,
    valueAnchor: stored.valueAnchor,
    executionPriceLocal: stored.executionPriceLocal,
    sellerFundName: stored.sellerFundName,
    buyerFundName: stored.buyerFundName,
    anchorCurrencyCode: stored.anchorCurrencyCode,
    ...(stored.corpCurrencyCode !== undefined ? { corpCurrencyCode: stored.corpCurrencyCode } : {}),
    sellerAvgCostAnchor: stored.sellerAvgCostAnchor,
    turn: stored.turn,
    now: new Date(stored.nowIso),
    outcome:
      stored.outcome && isFundCrossTransferOutcome(stored.outcome)
        ? { ...stored.outcome }
        : undefined,
  };
}

function planOutcome(plan: NormalizedCrossPlan): FundCrossTransferOutcome {
  if (plan.outcome) return { ...plan.outcome };
  // A completed receipt always carries the stored outcome; this fallback only
  // runs when the process crashed between settling `completed` and writing
  // the outcome row. Every number is pinned in the plan, so no live read is
  // needed and the report is exactly the attempted transfer.
  return { sharesTransferred: plan.shares, valueTransferred: plan.valueAnchor };
}

function mapCrossError(stepName: string, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical surface: a lost seller race reports a plain
  // skip (the old guarded debit returned false), a lost buyer or cash race
  // reports a plain skip after the prefix compensates (the old code rolled
  // the shares back and returned false), and anything later is pathological
  // (the legacy sequential writes had no recovery there either).
  if (stepName === "seller-cap-debit") return new Error(`${FUND_CROSS_TRANSFER_SELLER}:${outcome}`);
  if (stepName === "buyer-cap-credit") return new Error(`${FUND_CROSS_TRANSFER_BUYER}:${outcome}`);
  if (stepName === "buyer-cash-debit") return new Error(`${FUND_CROSS_TRANSFER_CASH}:${outcome}`);
  if (stepName === "seller-cash-credit")
    return new Error(`${FUND_CROSS_TRANSFER_SELLER_CASH}:${outcome}`);
  if (stepName === "seller-holdings" || stepName === "buyer-holdings")
    return new Error(`${FUND_CROSS_TRANSFER_HOLDINGS}:${outcome}`);
  return new Error(`${FUND_CROSS_TRANSFER_TX}:${outcome}`);
}

/** Corporation document shape touched by the cross-fund cap-table steps. */
interface CrossCorpAccount extends MoneyFlowAccount {
  shareholders?: Shareholder[];
}

function findFundEntry(
  shareholders: Shareholder[] | undefined,
  fundId: ObjectId
): Shareholder | undefined {
  return shareholders?.find((entry) => entry.fundId?.toString() === fundId.toString());
}

/**
 * Keyed seller cap-table debit (issue #1672): the same guarded
 * `$inc` `debitSharesFromFund` performs with `requireSufficient` (same
 * `$elemMatch` sufficiency guard, no float change — shares move fund to
 * fund, corp totals are untouched), carrying the flow's idempotency key so a
 * retried transfer debits the seller exactly once. The legacy zero-share row
 * pull stays out of the flow: it runs post-commit as best effort (a
 * concurrent re-buy that lands in between keeps its row, where the legacy
 * pull would have removed it).
 */
function makeSellerCapDebitStep(db: Db, key: string, plan: NormalizedCrossPlan): MoneyFlowStep {
  const subkey = deriveMoneyFlowKey(key, "seller-cap-debit");
  const corps = db.collection<CrossCorpAccount>("corporations");
  return {
    name: "seller-cap-debit",
    apply: (stepOpts) =>
      applyKeyedUpdate(
        subkey,
        {
          collection: corps,
          filter: {
            _id: plan.corpId,
            shareholders: {
              $elemMatch: { fundId: plan.sellerFundId, shares: { $gte: plan.shares } },
            },
          } as Filter<CrossCorpAccount>,
          update: {
            $inc: { "shareholders.$.shares": -plan.shares },
            $set: { updatedAt: plan.now },
          },
        },
        stepOpts ?? {}
      ),
    revert: (stepOpts) =>
      applyKeyedUpdate(
        deriveMoneyFlowKey(subkey, "compensate", "seller-cap-debit"),
        {
          collection: corps,
          filter: {
            _id: plan.corpId,
            shareholders: { $elemMatch: { fundId: plan.sellerFundId } },
          } as Filter<CrossCorpAccount>,
          update: {
            $inc: { "shareholders.$.shares": plan.shares },
            $set: { updatedAt: plan.now },
          },
        },
        stepOpts ?? {}
      ),
  };
}

/**
 * Keyed buyer cap-table credit (issue #1672): the same guarded
 * `$inc`/`$push` pair `creditSharesToFund` performs, carrying the flow's
 * idempotency key so a retried transfer credits the buyer exactly once.
 * Tries the positional increment when the buyer already holds the corp, the
 * push when it does not, and the increment once more when a row raced in
 * between, mirroring the legacy triple attempt. The average-cost basis is
 * computed from a live read inside the apply, so a crash between the read
 * and the guarded write retries from the same live state and converges.
 */
async function applyBuyerCapCreditKeyed(
  db: Db,
  key: string,
  plan: NormalizedCrossPlan,
  now: Date,
  sessionOpts: MoneyFlowOptions
): Promise<MoneyFlowLegOutcome> {
  const corps = db.collection<CrossCorpAccount>("corporations");
  const attemptInc = async (): Promise<MoneyFlowLegOutcome> => {
    const live = await corps.findOne({ _id: plan.corpId } as Filter<CrossCorpAccount>, {
      projection: { shareholders: 1 },
      ...(sessionOpts.session ? { session: sessionOpts.session } : {}),
    });
    if (!live) return "missing";
    const existing = findFundEntry(live.shareholders, plan.buyerFundId);
    if (!existing) return "guard-rejected";
    const price = plan.executionPriceLocal;
    const newAvg =
      existing.shares > 0
        ? (existing.shares * (existing.avgCostPerShare ?? price) + plan.shares * price) /
          (existing.shares + plan.shares)
        : price;
    return applyKeyedUpdate(
      key,
      {
        collection: corps,
        filter: {
          _id: plan.corpId,
          "shareholders.fundId": plan.buyerFundId,
        } as Filter<CrossCorpAccount>,
        update: {
          $inc: { "shareholders.$.shares": plan.shares },
          $set: { "shareholders.$.avgCostPerShare": newAvg, updatedAt: now },
        },
      },
      sessionOpts
    );
  };

  const first = await attemptInc();
  // A same-key retry after the push variant applied lands here as
  // `already-applied` (the row now exists and the key is recorded), so the
  // flow converges instead of pushing a second row.
  if (first === "applied" || first === "already-applied") return first;
  if (first === "missing") return first;

  const pushed = await applyKeyedUpdate(
    key,
    {
      collection: corps,
      filter: {
        _id: plan.corpId,
        shareholders: { $not: { $elemMatch: { fundId: plan.buyerFundId } } },
      } as Filter<CrossCorpAccount>,
      update: {
        $push: {
          shareholders: {
            fundId: plan.buyerFundId,
            shares: plan.shares,
            avgCostPerShare: plan.executionPriceLocal,
          },
        },
        $set: { updatedAt: now },
      },
    },
    sessionOpts
  );
  if (pushed === "applied" || pushed === "already-applied") return pushed;
  if (pushed === "missing") return pushed;

  // A holder row raced in between the two variants: retry the increment once,
  // mirroring the legacy triple attempt.
  return attemptInc();
}

/**
 * Inverse of the buyer cap-table credit: returns the shares to the seller
 * entry and restores the average-cost basis by removing exactly this transfer
 * from the live entry (the exact inverse of the weighted-average apply).
 * When the push variant applied, the entry holds exactly this transfer and is
 * pulled, leaving no zero-share row behind. A vanished entry means the effect
 * is already gone, so the revert converges.
 */
async function revertBuyerCapCreditKeyed(
  db: Db,
  key: string,
  plan: NormalizedCrossPlan,
  now: Date,
  sessionOpts: MoneyFlowOptions
): Promise<MoneyFlowLegOutcome> {
  const corps = db.collection<CrossCorpAccount>("corporations");
  const live = await corps.findOne({ _id: plan.corpId } as Filter<CrossCorpAccount>, {
    projection: { shareholders: 1 },
    ...(sessionOpts.session ? { session: sessionOpts.session } : {}),
  });
  if (!live) return "missing";
  const entry = findFundEntry(live.shareholders, plan.buyerFundId);
  if (!entry) return "already-applied";
  if (entry.shares <= plan.shares) {
    return applyKeyedUpdate(
      key,
      {
        collection: corps,
        filter: { _id: plan.corpId } as Filter<CrossCorpAccount>,
        update: {
          $pull: { shareholders: { fundId: plan.buyerFundId } },
          $set: { updatedAt: now },
        },
      },
      sessionOpts
    );
  }
  const price = plan.executionPriceLocal;
  const restoredAvg =
    (entry.shares * (entry.avgCostPerShare ?? price) - plan.shares * price) /
    (entry.shares - plan.shares);
  return applyKeyedUpdate(
    key,
    {
      collection: corps,
      // The buyer row must still exist for the positional `$` to resolve:
      // real Mongo throws when the update carries `shareholders.$` but the
      // filter names no array element, so a bare `{ _id }` filter would make
      // every compensation of a pre-existing buyer row crash instead of
      // reverting. (A row already gone converges earlier via the live-read
      // check; a row removed between that read and this write reports
      // `guard-rejected`, settling UNCOMPENSATED fail-closed.)
      filter: {
        _id: plan.corpId,
        "shareholders.fundId": plan.buyerFundId,
      } as Filter<CrossCorpAccount>,
      update: {
        $inc: { "shareholders.$.shares": -plan.shares },
        $set: { "shareholders.$.avgCostPerShare": restoredAvg, updatedAt: now },
      },
    },
    sessionOpts
  );
}

function makeBuyerCapCreditStep(db: Db, key: string, plan: NormalizedCrossPlan): MoneyFlowStep {
  const subkey = deriveMoneyFlowKey(key, "buyer-cap-credit");
  return {
    name: "buyer-cap-credit",
    apply: (stepOpts) => applyBuyerCapCreditKeyed(db, subkey, plan, plan.now, stepOpts ?? {}),
    revert: (stepOpts) =>
      revertBuyerCapCreditKeyed(
        db,
        deriveMoneyFlowKey(subkey, "compensate", "buyer-cap-credit"),
        plan,
        plan.now,
        stepOpts ?? {}
      ),
  };
}

interface FundHoldingsAccount extends MoneyFlowAccount {
  holdings?: IndexFundHolding[];
}

/**
 * Seller holdings image after the sale (same formula the cron always used).
 * Shared with the cross-fund pass planner (re-exported via
 * `fundCrossRebalancing` for its historical import path).
 */
export function updateHoldingAfterSale(
  holdings: IndexFundHolding[],
  corporationId: ObjectId,
  soldShares: number,
  sharePriceAnchor: number
): IndexFundHolding[] {
  return holdings
    .map((h) => {
      if (h.corporationId.toString() !== corporationId.toString()) return h;
      const newShares = h.shares - soldShares;
      if (newShares <= 0) return null;
      return {
        ...h,
        shares: newShares,
        lastValueAnchor: newShares * sharePriceAnchor,
      };
    })
    .filter((h): h is IndexFundHolding => h !== null);
}

/** Inverse of the seller holdings write, computed from live state: restores exactly this sale. */
function holdingsBeforeSale(
  holdings: IndexFundHolding[],
  corporationId: ObjectId,
  soldShares: number,
  sharePriceAnchor: number,
  holdingAvgCostAnchor: number | null
): IndexFundHolding[] {
  const out: IndexFundHolding[] = [];
  let restored = false;
  for (const h of holdings) {
    if (h.corporationId.toString() !== corporationId.toString()) {
      out.push(h);
      continue;
    }
    restored = true;
    out.push({
      ...h,
      shares: h.shares + soldShares,
      lastValueAnchor: (h.lastValueAnchor ?? 0) + soldShares * sharePriceAnchor,
    });
  }
  if (!restored) {
    // The sale emptied the position and the apply removed the row: push it
    // back with the pinned average (selling never changes the average, so
    // restoring it needs the pre-sale figure, which the caller pinned).
    out.push({
      corporationId,
      shares: soldShares,
      avgCostPerShareAnchor: holdingAvgCostAnchor ?? sharePriceAnchor,
      lastValueAnchor: soldShares * sharePriceAnchor,
    });
  }
  return out;
}

/** Buyer holdings image after the purchase (same formula the cron always used). */
export function updateHoldingAfterPurchase(
  holdings: IndexFundHolding[],
  corporationId: ObjectId,
  additionalShares: number,
  sharePriceAnchor: number
): IndexFundHolding[] {
  const existing = holdings.find((h) => h.corporationId.toString() === corporationId.toString());
  if (existing) {
    return holdings.map((h) => {
      if (h.corporationId.toString() !== corporationId.toString()) return h;
      const newShares = h.shares + additionalShares;
      const newAvg =
        h.avgCostPerShareAnchor !== undefined
          ? (h.shares * h.avgCostPerShareAnchor + additionalShares * sharePriceAnchor) / newShares
          : sharePriceAnchor;
      return {
        ...h,
        shares: newShares,
        avgCostPerShareAnchor: newAvg,
        lastValueAnchor: newShares * sharePriceAnchor,
      };
    });
  }
  return [
    ...holdings,
    {
      corporationId,
      shares: additionalShares,
      avgCostPerShareAnchor: sharePriceAnchor,
      lastValueAnchor: additionalShares * sharePriceAnchor,
    },
  ];
}

/** Inverse of the buyer holdings write, computed from live state: removes exactly this purchase. */
function holdingsBeforePurchase(
  holdings: IndexFundHolding[],
  corporationId: ObjectId,
  boughtShares: number,
  sharePriceAnchor: number
): IndexFundHolding[] {
  const out: IndexFundHolding[] = [];
  for (const h of holdings) {
    if (h.corporationId.toString() !== corporationId.toString()) {
      out.push(h);
      continue;
    }
    if (h.shares <= boughtShares) continue;
    const restoredAvg =
      (h.shares * (h.avgCostPerShareAnchor ?? sharePriceAnchor) - boughtShares * sharePriceAnchor) /
      (h.shares - boughtShares);
    out.push({
      ...h,
      shares: h.shares - boughtShares,
      avgCostPerShareAnchor: restoredAvg,
      lastValueAnchor: Math.max(0, (h.lastValueAnchor ?? 0) - boughtShares * sharePriceAnchor),
    });
  }
  return out;
}

function readHoldings(
  db: Db,
  fundId: ObjectId,
  sessionOpts: MoneyFlowOptions
): Promise<IndexFundHolding[] | null> {
  const funds = db.collection<FundHoldingsAccount>("indexFunds");
  return funds
    .findOne({ _id: fundId } as Filter<FundHoldingsAccount>, {
      projection: { holdings: 1 },
      ...(sessionOpts.session ? { session: sessionOpts.session } : {}),
    })
    .then((live) => {
      if (!live) return null;
      return (live.holdings ?? []) as IndexFundHolding[];
    });
}

function makeSellerHoldingsStep(db: Db, key: string, plan: NormalizedCrossPlan): MoneyFlowStep {
  const subkey = deriveMoneyFlowKey(key, "seller-holdings");
  return {
    name: "seller-holdings",
    apply: async (stepOpts) => {
      const opts = stepOpts ?? {};
      const live = await readHoldings(db, plan.sellerFundId, opts);
      if (live === null) return "missing";
      const image = updateHoldingAfterSale(
        live,
        plan.corpId,
        plan.shares,
        plan.pricePerShareAnchor
      );
      return applyKeyedUpdate(
        subkey,
        {
          collection: db.collection<FundHoldingsAccount>("indexFunds"),
          filter: { _id: plan.sellerFundId } as Filter<FundHoldingsAccount>,
          update: { $set: { holdings: image, updatedAt: plan.now } },
        },
        opts
      );
    },
    revert: async (stepOpts) => {
      const opts = stepOpts ?? {};
      const live = await readHoldings(db, plan.sellerFundId, opts);
      if (live === null) return "missing";
      const image = holdingsBeforeSale(
        live,
        plan.corpId,
        plan.shares,
        plan.pricePerShareAnchor,
        plan.sellerAvgCostAnchor
      );
      return applyKeyedUpdate(
        deriveMoneyFlowKey(subkey, "compensate", "seller-holdings"),
        {
          collection: db.collection<FundHoldingsAccount>("indexFunds"),
          filter: { _id: plan.sellerFundId } as Filter<FundHoldingsAccount>,
          update: { $set: { holdings: image, updatedAt: plan.now } },
        },
        opts
      );
    },
  };
}

function makeBuyerHoldingsStep(db: Db, key: string, plan: NormalizedCrossPlan): MoneyFlowStep {
  const subkey = deriveMoneyFlowKey(key, "buyer-holdings");
  return {
    name: "buyer-holdings",
    apply: async (stepOpts) => {
      const opts = stepOpts ?? {};
      const live = await readHoldings(db, plan.buyerFundId, opts);
      if (live === null) return "missing";
      const image = updateHoldingAfterPurchase(
        live,
        plan.corpId,
        plan.shares,
        plan.pricePerShareAnchor
      );
      return applyKeyedUpdate(
        subkey,
        {
          collection: db.collection<FundHoldingsAccount>("indexFunds"),
          filter: { _id: plan.buyerFundId } as Filter<FundHoldingsAccount>,
          update: { $set: { holdings: image, updatedAt: plan.now } },
        },
        opts
      );
    },
    revert: async (stepOpts) => {
      const opts = stepOpts ?? {};
      const live = await readHoldings(db, plan.buyerFundId, opts);
      if (live === null) return "missing";
      const image = holdingsBeforePurchase(
        live,
        plan.corpId,
        plan.shares,
        plan.pricePerShareAnchor
      );
      return applyKeyedUpdate(
        deriveMoneyFlowKey(subkey, "compensate", "buyer-holdings"),
        {
          collection: db.collection<FundHoldingsAccount>("indexFunds"),
          filter: { _id: plan.buyerFundId } as Filter<FundHoldingsAccount>,
          update: { $set: { holdings: image, updatedAt: plan.now } },
        },
        opts
      );
    },
  };
}

/**
 * Build the ordered keyed steps for a cross-fund transfer attempt. Exported
 * for focused compensation tests: a test can sabotage one step and assert
 * the applied prefix reverses exactly. Production always runs these through
 * `applyFundCrossTransferSpend` (claim + stored plan + settlement).
 */
export function buildCrossTransferSteps(
  db: Db,
  key: string,
  input: FundCrossTransferSpendInput,
  now: Date
): MoneyFlowStep[] {
  const plan = planFromInput(input, now);
  const funds = db.collection<MoneyFlowAccount>("indexFunds");
  const txs = db.collection<IndexFundTransaction>("indexFundTransactions");

  const steps: MoneyFlowStep[] = [
    makeSellerCapDebitStep(db, key, plan),
    makeBuyerCapCreditStep(db, key, plan),
    makeLegStep(key, {
      name: "buyer-cash-debit",
      collection: funds,
      docId: plan.buyerFundId,
      field: "cashAnchor",
      delta: -plan.valueAnchor,
      minBalance: plan.valueAnchor,
      set: { updatedAt: plan.now },
    }),
    makeLegStep(key, {
      name: "seller-cash-credit",
      collection: funds,
      docId: plan.sellerFundId,
      field: "cashAnchor",
      delta: plan.valueAnchor,
      set: { updatedAt: plan.now },
    }),
    makeSellerHoldingsStep(db, key, plan),
    makeBuyerHoldingsStep(db, key, plan),
  ];

  // Terminal: nothing runs after them, so they carry no inverse. A survived
  // insert error compensates the prefix instead of stranding moved money
  // with no audit row. The `_id`s derive from the flow key, so a crash
  // between the inserts and the receipt completion converges instead of
  // duplicating the rows.
  steps.push(
    makeInsertStep("cross-tx-sell", txs, {
      _id: keyedInsertId(key, SELL_TX_INSERT_DOMAIN),
      fundId: plan.sellerFundId,
      kind: "cross_fund_sell",
      corporationId: plan.corpId,
      shares: plan.shares,
      navAnchor: plan.pricePerShareAnchor,
      amountAnchor: plan.valueAnchor,
      note: `Sold ${plan.shares} shares to ${plan.buyerFundName}`,
      createdAt: plan.now,
    } satisfies IndexFundTransaction)
  );
  steps.push(
    makeInsertStep("cross-tx-buy", txs, {
      _id: keyedInsertId(key, BUY_TX_INSERT_DOMAIN),
      fundId: plan.buyerFundId,
      kind: "cross_fund_buy",
      corporationId: plan.corpId,
      shares: plan.shares,
      navAnchor: plan.pricePerShareAnchor,
      amountAnchor: plan.valueAnchor,
      note: `Bought ${plan.shares} shares from ${plan.sellerFundName}`,
      createdAt: plan.now,
    } satisfies IndexFundTransaction)
  );

  return steps;
}

/**
 * Post-commit side effects for one landed transfer (issue #1672): the public
 * trade-history log and the zero-share registry sweep on the seller's
 * cap-table row. Both are best effort and run only for the fresh attempt
 * (the pass driver calls this when the primitive reports
 * `duplicate: false`), never on a same-key replay (which already fired
 * them). The sweep spares a concurrently re-bought row (shares above zero),
 * where the legacy unconditional pull would have removed it.
 */
export async function fireCrossTransferPostCommit(
  db: Db,
  leg: {
    corpId: ObjectId;
    sellerFundId: ObjectId;
    sellerFundName: string;
    buyerFundName: string;
    shares: number;
    pricePerShareAnchor: number;
    corpCurrencyCode?: string;
    turn: number;
  },
  sessionOpts: { session?: ClientSession } = {}
): Promise<void> {
  void recordShareTrade(db, {
    corporationId: leg.corpId,
    kind: "market_buy",
    turn: leg.turn,
    shares: leg.shares,
    pricePerShareAnchor: leg.pricePerShareAnchor,
    from: { name: `${leg.sellerFundName} (index fund)` },
    to: { name: `${leg.buyerFundName} (index fund)` },
    corpCurrencyCode: leg.corpCurrencyCode,
    note: "Cross-fund rebalancing transfer",
  });
  try {
    await db
      .collection("corporations")
      .updateOne(
        { _id: leg.corpId },
        { $pull: { shareholders: { fundId: leg.sellerFundId, shares: { $lte: 0 } } } },
        sessionOpts.session ? { session: sessionOpts.session } : undefined
      );
  } catch {
    // Best effort: a lingering zero-share row matches no sufficiency guard.
  }
}

/**
 * Move shares seller → buyer and cash buyer → seller between two index funds
 * so the result is exactly-once on every topology (issue #1672).
 *
 * Step order mirrors the historical write order (seller cap-table debit,
 * buyer cap-table credit, cash move, holdings writes, transaction rows), and
 * a later-step failure compensates its own prefix (cash refunded, shares
 * returned) instead of leaving a strand where the seller lost shares but the
 * buyer holds no cash debit.
 *
 * Fan-out keying: the seller debit carries its own idempotent sub-operation
 * key derived via `deriveMoneyFlowKey` (same for the buyer credit, the cash
 * legs on the flow key, the holdings writes, plus the deterministic audit-row
 * `_id`s), so a crash between any two writes resumes per step: applied steps
 * report `already-applied` and are skipped while the rest still land.
 *
 * The caller (the cross-fund pass) owns everything ambient: the drift math,
 * the price, the value, and the fund names. Those arrive here as pinned
 * amounts on the input and are persisted on the receipt plan at claim time,
 * so a same-key retry never recomputes them from post-debit state.
 *
 * Under real transactions the debits, the credits, the holdings writes, the
 * audit rows, and the idempotency receipt join the caller's transaction and
 * commit atomically, preserving the old behavior. On a standalone deployment
 * the fallback runs the same writes as keyed idempotent steps: a crash
 * between them leaves an `in_progress` receipt, and retrying with the same
 * key and fingerprint reconciles to exactly one transfer. A retry after a
 * terminal failure throws `MoneyFlowTerminalError` (fail closed); a new
 * attempt needs a new key. Pass-level replays reuse the stored plan (see
 * `executeFundCrossRebalancing`); there is no separate orphan driver for
 * cross transfers (like buys/sales, no intent row exists to strand): an
 * unretried partial stays exactly as the crash left it, and the next turn's
 * pass runs under a new key.
 */
export async function applyFundCrossTransferSpend(
  db: Db,
  input: FundCrossTransferSpendInput,
  opts?: MoneyFlowOptions
): Promise<{ duplicate: boolean; outcome: FundCrossTransferOutcome }> {
  if (!input.sellerFundId) {
    throw new TypeError("Fund cross transfer needs sellerFundId");
  }
  if (!input.buyerFundId) {
    throw new TypeError("Fund cross transfer needs buyerFundId");
  }
  if (input.sellerFundId.toString() === input.buyerFundId.toString()) {
    throw new RangeError("Fund cross transfer seller and buyer must differ");
  }
  if (!input.corpId) {
    throw new TypeError("Fund cross transfer needs corpId");
  }
  if (!Number.isInteger(input.shares) || input.shares <= 0) {
    throw new RangeError("Fund cross transfer shares must be a positive integer");
  }
  if (!Number.isFinite(input.pricePerShareAnchor) || input.pricePerShareAnchor <= 0) {
    throw new RangeError(
      "Fund cross transfer pricePerShareAnchor must be a positive finite amount"
    );
  }
  if (!Number.isFinite(input.valueAnchor) || input.valueAnchor <= 0) {
    throw new RangeError("Fund cross transfer valueAnchor must be a positive finite amount");
  }
  if (!Number.isFinite(input.executionPriceLocal) || input.executionPriceLocal <= 0) {
    throw new RangeError(
      "Fund cross transfer executionPriceLocal must be a positive finite amount"
    );
  }
  if (typeof input.sellerFundName !== "string" || input.sellerFundName.length === 0) {
    throw new TypeError("Fund cross transfer needs sellerFundName");
  }
  if (typeof input.buyerFundName !== "string" || input.buyerFundName.length === 0) {
    throw new TypeError("Fund cross transfer needs buyerFundName");
  }
  if (
    input.sellerAvgCostAnchor !== null &&
    (!Number.isFinite(input.sellerAvgCostAnchor) || input.sellerAvgCostAnchor < 0)
  ) {
    throw new RangeError(
      "Fund cross transfer sellerAvgCostAnchor must be null or a finite non-negative amount"
    );
  }
  if (!Number.isInteger(input.turn) || input.turn < 0) {
    throw new RangeError("Fund cross transfer turn must be a non-negative integer");
  }
  if (typeof input.fingerprint !== "string" || input.fingerprint.length === 0) {
    throw new TypeError("Fund cross transfer needs a non-empty fingerprint");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Fund cross transfer idempotency key must be 1-128 characters");
  }

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<FundCrossTransferReceipt>;
  const now = new Date();

  const persistOutcome = async (
    plan: NormalizedCrossPlan,
    stepOpts: { session?: ClientSession }
  ): Promise<FundCrossTransferOutcome> => {
    const outcome = planOutcome(plan);
    await receiptCollection.updateOne(
      { _id: key },
      {
        $set: {
          fundCrossTransferPlan: { ...toStoredPlanLike(plan), outcome },
          updatedAt: new Date(),
        },
      },
      stepOpts.session ? { session: stepOpts.session } : {}
    );
    return outcome;
  };

  const runPlan = async (
    plan: NormalizedCrossPlan,
    stepInput: FundCrossTransferSpendInput,
    stepOpts: { session?: ClientSession }
  ): Promise<FundCrossTransferOutcome> => {
    await runMoneyFlowSteps(
      receipts,
      key,
      buildCrossTransferSteps(db, key, stepInput, plan.now),
      (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome) => mapCrossError(step.name, outcome),
      stepOpts
    );
    return persistOutcome(plan, stepOpts);
  };

  const storedInput = (stored: FundCrossTransferStoredPlan): FundCrossTransferSpendInput => ({
    sellerFundId: new ObjectId(stored.sellerFundIdHex),
    buyerFundId: new ObjectId(stored.buyerFundIdHex),
    corpId: new ObjectId(stored.corpIdHex),
    shares: stored.shares,
    pricePerShareAnchor: stored.pricePerShareAnchor,
    valueAnchor: stored.valueAnchor,
    executionPriceLocal: stored.executionPriceLocal,
    sellerFundName: stored.sellerFundName,
    buyerFundName: stored.buyerFundName,
    anchorCurrencyCode: stored.anchorCurrencyCode,
    ...(stored.corpCurrencyCode !== undefined ? { corpCurrencyCode: stored.corpCurrencyCode } : {}),
    sellerAvgCostAnchor: stored.sellerAvgCostAnchor,
    turn: stored.turn,
    fingerprint: input.fingerprint,
    idempotencyKey: key,
  });

  const runSpend = async (
    session?: ClientSession
  ): Promise<{ duplicate: boolean; outcome: FundCrossTransferOutcome }> => {
    const stepOpts = session ? { session } : {};
    let claim: Awaited<ReturnType<typeof claimMoneyFlowReceipt>>;
    try {
      claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, stepOpts);
    } catch (err) {
      if (!(err instanceof MoneyFlowKeyConflictError)) throw err;
      // Same key, different fingerprint: a genuinely different transfer
      // reusing the key, not a post-crash remainder. Fail closed.
      throw err;
    }
    if (claim === "duplicate") {
      const existing = await receiptCollection.findOne({ _id: key }, stepOpts);
      const stored = existing?.fundCrossTransferPlan;
      if (!isStoredPlan(stored)) {
        throw new Error("MONEY_FLOW_RECEIPT_LOST");
      }
      return {
        duplicate: true,
        outcome: await persistOutcome(planFromStored(stored), stepOpts),
      };
    }
    if (claim === "in-progress") {
      // Same fingerprint, so the live input names the same transfer, but the
      // steps run from the STORED plan when one exists, never the live
      // input: post-crash reads are post-debit state and would repeat or
      // misprice. No stored plan means the crash landed between the claim
      // insert and the plan write below (nothing applied yet), so the live
      // input under the stored fingerprint is exact.
      const existing = await receiptCollection.findOne({ _id: key }, stepOpts);
      const stored = existing?.fundCrossTransferPlan;
      if (isStoredPlan(stored)) {
        const plan = planFromStored(stored);
        const outcome = await runPlan(plan, storedInput(stored), stepOpts);
        return { duplicate: true, outcome };
      }
      const plan = planFromInput(input, now);
      const outcome = await runPlan(plan, input, stepOpts);
      return { duplicate: true, outcome };
    }
    // A fresh claim owns the attempt. Persist the resume plan before the
    // first step: a crash from here on resumes this exact plan under the same
    // key.
    try {
      await receiptCollection.updateOne(
        { _id: key },
        { $set: { fundCrossTransferPlan: toStoredPlan(input, now), updatedAt: new Date() } },
        stepOpts
      );
    } catch (planError) {
      await failMoneyFlowReceipt(receipts, key, `${FUND_CROSS_TRANSFER_TX}:plan-store`, stepOpts);
      throw planError;
    }

    const plan = planFromInput(input, now);
    const outcome = await runPlan(plan, input, stepOpts);
    return { duplicate: false, outcome };
  };

  // Join the caller's transaction when one is in flight; otherwise manage our
  // own like every other spend primitive. Never open a nested transaction
  // around an outer session.
  if (opts?.session) return runSpend(opts.session);
  return runWithOptionalTransaction(
    async (session) => runSpend(session ?? undefined),
    async () => runSpend()
  );
}

/** Rebuild a storable plan snapshot from a normalized plan (for outcome writes). */
function toStoredPlanLike(plan: NormalizedCrossPlan): FundCrossTransferStoredPlan {
  return {
    version: 1,
    sellerFundIdHex: plan.sellerFundId.toHexString(),
    buyerFundIdHex: plan.buyerFundId.toHexString(),
    corpIdHex: plan.corpId.toHexString(),
    shares: plan.shares,
    pricePerShareAnchor: plan.pricePerShareAnchor,
    valueAnchor: plan.valueAnchor,
    executionPriceLocal: plan.executionPriceLocal,
    sellerFundName: plan.sellerFundName,
    buyerFundName: plan.buyerFundName,
    anchorCurrencyCode: plan.anchorCurrencyCode,
    ...(plan.corpCurrencyCode !== undefined ? { corpCurrencyCode: plan.corpCurrencyCode } : {}),
    sellerAvgCostAnchor: plan.sellerAvgCostAnchor,
    turn: plan.turn,
    nowIso: plan.now.toISOString(),
    ...(plan.outcome ? { outcome: { ...plan.outcome } } : {}),
  };
}

/** Resume helper for the pass driver and ops: re-drive one transfer key to convergence. */
export async function resumeFundCrossTransferByKey(
  db: Db,
  key: string,
  fingerprint: string,
  input: FundCrossTransferSpendInput
): Promise<{ duplicate: boolean; outcome: FundCrossTransferOutcome }> {
  return applyFundCrossTransferSpend(db, { ...input, idempotencyKey: key, fingerprint });
}
