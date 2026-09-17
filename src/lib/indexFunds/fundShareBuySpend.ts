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
import { EQUITY_MARKET_POOLS_COLLECTION } from "@/lib/db/types/equityMarketPool";
import type { EquityMarketPool } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { IndexFundHolding, IndexFundTransaction, Shareholder } from "@/lib/db/types";

/** Fund debit lost its race (cash drained) or the fund row went: caller skips the buy. */
export const FUND_SHARE_BUY_FUNDS = "FUND_SHARE_BUY_FUNDS";
/** Corp float/shareholder write lost its race: caller skips the buy (prefix compensated). */
export const FUND_SHARE_BUY_CORP = "FUND_SHARE_BUY_CORP";
/** Issuer-side credit failed after money moved: prefix compensated, caller treats as pathological. */
export const FUND_SHARE_BUY_ISSUER = "FUND_SHARE_BUY_ISSUER";
/** Fund holdings write failed after money moved: prefix compensated, caller treats as pathological. */
export const FUND_SHARE_BUY_HOLDINGS = "FUND_SHARE_BUY_HOLDINGS";
/** Buy audit-row insert failed after money moved: prefix compensated, caller retries next turn. */
export const FUND_SHARE_BUY_TX = "FUND_SHARE_BUY_TX";

/** Domain for the deterministic buy audit-row `_id` derived from the flow key. */
const TX_INSERT_DOMAIN = "indexfund-share-buy-tx";

/** Where the issuer side of a float buy settles. Pinned by the caller at quote time. */
export type FundShareBuyIssuerRoute = "pool" | "escrow" | "liquid";

export interface FundShareBuySpendInput {
  fundId: ObjectId;
  corpId: ObjectId;
  /** Whole shares bought from the public float. */
  shares: number;
  /** Executable ask in the corp local currency (pool quote). */
  executionPriceLocal: number;
  /** Executable ask in the fund anchor currency (caller FX reference plus spread). */
  executionPriceAnchor: number;
  /** Anchor debited from the fund (`shares` x `executionPriceAnchor`). */
  actualCost: number;
  /** Local-currency issuer credit (`shares` x `executionPriceLocal`). */
  issuerCreditLocal: number;
  /** Whether the legacy order-flow window tally applies to this corp. */
  orderFlowEligible: boolean;
  /** Pool currency the issuer credit settles in (pool route). */
  currency: CurrencyCode;
  /** Issuer settlement route, resolved by the caller exactly like `applyFloatBuyCredit`. */
  issuerRoute: FundShareBuyIssuerRoute;
  /** Cron turn, for keying. */
  turn: number;
  /**
   * Caller-chosen fingerprint of the intended buy (see
   * `buildFundShareBuyFingerprint`). A retry with the same key and
   * fingerprint reconciles the stored plan; a different fingerprint is a
   * different buy and stays a `MoneyFlowKeyConflictError`.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key. The cron derives one per fund, corp,
   * turn, and share count (see `buildFundShareBuyKey`) so a same-turn retry
   * resumes instead of double-buying. Omit to mint one: the attempt is still
   * crash-safe within itself, but a client retry mints a new key and is
   * treated as a new buy (still guarded by the atomic debit).
   */
  idempotencyKey?: string;
  /**
   * Preloaded equity pools for a pass of many buys. Only pool EXISTENCE is
   * never decided from it here (the route arrives pinned); a pool-route apply
   * advances the snapshot's cash so later quotes in the same pass see the
   * skew, exactly like the legacy issuer-credit path did. Never persisted.
   */
  pools?: Map<CurrencyCode, EquityMarketPool>;
}

/**
 * Deterministic idempotency key for one float buy: the rebalance plan emits
 * at most one buy leg per corp per pass, so fund + corp + turn + shares names
 * the attempt. A same-turn retry (crash recovery, same-turn double-fire)
 * reuses it and reconciles; a recomputed different-size buy gets a new key
 * and runs as a fresh guarded attempt.
 */
export function buildFundShareBuyKey(
  fundId: ObjectId,
  corpId: ObjectId,
  turn: number,
  shares: number
): string {
  return `fund-share-buy:${fundId.toHexString()}:${corpId.toHexString()}:turn:${turn}:shares:${shares}`;
}

/**
 * Deterministic fingerprint for one float-buy attempt. Covers the operation
 * identity (fund, corp, turn) plus every pinned amount and the issuer route,
 * so a key reused for a different buy fails closed instead of replaying the
 * wrong outcome.
 */
export function buildFundShareBuyFingerprint(input: {
  fundId: ObjectId;
  corpId: ObjectId;
  shares: number;
  executionPriceLocal: number;
  executionPriceAnchor: number;
  actualCost: number;
  issuerCreditLocal: number;
  orderFlowEligible: boolean;
  currency: string;
  issuerRoute: FundShareBuyIssuerRoute;
  turn: number;
}): string {
  const cents = (n: number): string => String(Math.round(n * 100) / 100);
  return [
    "fund-share-buy",
    input.fundId.toHexString(),
    input.corpId.toHexString(),
    `shares:${input.shares}`,
    `price:${cents(input.executionPriceLocal)}`,
    `priceAnchor:${cents(input.executionPriceAnchor)}`,
    `cost:${cents(input.actualCost)}`,
    `issuer:${cents(input.issuerCreditLocal)}`,
    `orderflow:${input.orderFlowEligible ? "yes" : "no"}`,
    `ccy:${input.currency}`,
    `route:${input.issuerRoute}`,
    `turn:${input.turn}`,
  ].join(":");
}

/** Stored buy numbers, written post-commit so a replay reports stably. */
export interface FundShareBuyOutcome {
  sharesBought: number;
  anchorSpent: number;
}

export function isFundShareBuyOutcome(value: unknown): value is FundShareBuyOutcome {
  if (!value || typeof value !== "object") return false;
  const outcome = value as Record<string, unknown>;
  return typeof outcome.sharesBought === "number" && typeof outcome.anchorSpent === "number";
}

/**
 * Crash-resume plan persisted on the flow receipt right after the fresh
 * claim, before any money moves. A same-key retry after a crash rebuilds its
 * steps from THIS plan, never from the caller's live input: the cron prices
 * every buy from live pool quotes, so post-crash input is computed from
 * post-debit reads and running it would double-buy or misprice. Resuming the
 * stored plan keeps the fund debit, the corp reserve, the issuer credit, the
 * holdings write, and every compensation inverse at exactly the attempted
 * amounts.
 */
export interface FundShareBuyStoredPlan {
  version: 1;
  fundIdHex: string;
  corpIdHex: string;
  shares: number;
  executionPriceLocal: number;
  executionPriceAnchor: number;
  actualCost: number;
  issuerCreditLocal: number;
  orderFlowEligible: boolean;
  currency: CurrencyCode;
  issuerRoute: FundShareBuyIssuerRoute;
  turn: number;
  nowIso: string;
  outcome?: FundShareBuyOutcome;
}

function toStoredPlan(input: FundShareBuySpendInput, now: Date): FundShareBuyStoredPlan {
  return {
    version: 1,
    fundIdHex: input.fundId.toHexString(),
    corpIdHex: input.corpId.toHexString(),
    shares: input.shares,
    executionPriceLocal: input.executionPriceLocal,
    executionPriceAnchor: input.executionPriceAnchor,
    actualCost: input.actualCost,
    issuerCreditLocal: input.issuerCreditLocal,
    orderFlowEligible: input.orderFlowEligible,
    currency: input.currency,
    issuerRoute: input.issuerRoute,
    turn: input.turn,
    nowIso: now.toISOString(),
  };
}

function isStoredPlan(value: unknown): value is FundShareBuyStoredPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.version === 1 &&
    typeof plan.fundIdHex === "string" &&
    typeof plan.corpIdHex === "string" &&
    typeof plan.currency === "string" &&
    (plan.issuerRoute === "pool" || plan.issuerRoute === "escrow" || plan.issuerRoute === "liquid")
  );
}

/** Receipt rows carry the resume plan under this field (never in the shared type). */
type FundShareBuyReceipt = MoneyFlowReceipt & { fundShareBuyPlan?: unknown };

interface NormalizedBuyPlan {
  fundId: ObjectId;
  corpId: ObjectId;
  shares: number;
  executionPriceLocal: number;
  executionPriceAnchor: number;
  actualCost: number;
  issuerCreditLocal: number;
  orderFlowEligible: boolean;
  currency: CurrencyCode;
  issuerRoute: FundShareBuyIssuerRoute;
  turn: number;
  now: Date;
  pools?: Map<CurrencyCode, EquityMarketPool>;
  outcome?: FundShareBuyOutcome;
}

function planFromInput(live: FundShareBuySpendInput, now: Date): NormalizedBuyPlan {
  return {
    fundId: live.fundId,
    corpId: live.corpId,
    shares: live.shares,
    executionPriceLocal: live.executionPriceLocal,
    executionPriceAnchor: live.executionPriceAnchor,
    actualCost: live.actualCost,
    issuerCreditLocal: live.issuerCreditLocal,
    orderFlowEligible: live.orderFlowEligible,
    currency: live.currency,
    issuerRoute: live.issuerRoute,
    turn: live.turn,
    now,
    pools: live.pools,
  };
}

function planFromStored(
  stored: FundShareBuyStoredPlan,
  pools?: Map<CurrencyCode, EquityMarketPool>
): NormalizedBuyPlan {
  return {
    fundId: new ObjectId(stored.fundIdHex),
    corpId: new ObjectId(stored.corpIdHex),
    shares: stored.shares,
    executionPriceLocal: stored.executionPriceLocal,
    executionPriceAnchor: stored.executionPriceAnchor,
    actualCost: stored.actualCost,
    issuerCreditLocal: stored.issuerCreditLocal,
    orderFlowEligible: stored.orderFlowEligible,
    currency: stored.currency,
    issuerRoute: stored.issuerRoute,
    turn: stored.turn,
    now: new Date(stored.nowIso),
    pools,
    outcome:
      stored.outcome && isFundShareBuyOutcome(stored.outcome) ? { ...stored.outcome } : undefined,
  };
}

function planOutcome(plan: NormalizedBuyPlan): FundShareBuyOutcome {
  if (plan.outcome) return { ...plan.outcome };
  // A completed receipt always carries the stored outcome; this fallback only
  // runs when the process crashed between settling `completed` and writing
  // the outcome row. Every number is pinned in the plan, so no live read is
  // needed and the report is exactly the attempted buy.
  return { sharesBought: plan.shares, anchorSpent: plan.actualCost };
}

function mapBuyError(stepName: string, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical surface: a lost cash race reports a plain
  // failure (the old guarded debit returned false), a lost float race
  // reports a plain failure after the prefix compensates (the old code
  // refunded the debit and returned false), and anything later is
  // pathological (the legacy sequential writes had no recovery there either).
  if (stepName === "fund-debit") return new Error(`${FUND_SHARE_BUY_FUNDS}:${outcome}`);
  if (stepName === "corp-reserve") return new Error(`${FUND_SHARE_BUY_CORP}:${outcome}`);
  if (stepName === "issuer-credit") return new Error(`${FUND_SHARE_BUY_ISSUER}:${outcome}`);
  if (stepName === "fund-holdings") return new Error(`${FUND_SHARE_BUY_HOLDINGS}:${outcome}`);
  return new Error(`${FUND_SHARE_BUY_TX}:${outcome}`);
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Corporation document shape touched by the buy steps. */
interface BuyCorpAccount extends MoneyFlowAccount {
  publicFloat?: number;
  shareholders?: Shareholder[];
  orderFlowWindowBuyValue?: number;
  liquidCapital?: number;
  shareIssuanceProceeds?: number;
  shareEscrowBalance?: number;
}

function findFundEntry(
  shareholders: Shareholder[] | undefined,
  fundId: ObjectId
): Shareholder | undefined {
  return shareholders?.find((entry) => entry.fundId?.toString() === fundId.toString());
}

function orderFlowInc(plan: NormalizedBuyPlan): Record<string, number> {
  return plan.orderFlowEligible ? { orderFlowWindowBuyValue: plan.issuerCreditLocal } : {};
}

/**
 * Keyed corp float + shareholder write (issue #1672): the same guarded
 * `$inc`/`$push` pair `creditSharesToFund` performs, carrying the flow's
 * idempotency key so a retried buy credits the fund exactly once. Tries the
 * positional increment when the fund already holds the corp, the push when it
 * does not, and the increment once more when a row raced in between,
 * mirroring the legacy triple attempt. The average-cost basis is computed
 * from a live read inside the apply, so a crash between the read and the
 * guarded write retries from the same live state and converges.
 */
async function applyCorpReserveKeyed(
  db: Db,
  key: string,
  plan: NormalizedBuyPlan,
  now: Date,
  sessionOpts: MoneyFlowOptions
): Promise<MoneyFlowLegOutcome> {
  const corps = db.collection<BuyCorpAccount>("corporations");
  const attemptInc = async (): Promise<MoneyFlowLegOutcome> => {
    const live = await corps.findOne({ _id: plan.corpId } as Filter<BuyCorpAccount>, {
      projection: { shareholders: 1 },
      ...(sessionOpts.session ? { session: sessionOpts.session } : {}),
    });
    if (!live) return "missing";
    const existing = findFundEntry(live.shareholders, plan.fundId);
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
          publicFloat: { $gte: plan.shares },
          "shareholders.fundId": plan.fundId,
        } as Filter<BuyCorpAccount>,
        update: {
          $inc: {
            "shareholders.$.shares": plan.shares,
            publicFloat: -plan.shares,
            ...orderFlowInc(plan),
          },
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
        publicFloat: { $gte: plan.shares },
        shareholders: { $not: { $elemMatch: { fundId: plan.fundId } } },
      } as Filter<BuyCorpAccount>,
      update: {
        $push: {
          shareholders: {
            fundId: plan.fundId,
            shares: plan.shares,
            avgCostPerShare: plan.executionPriceLocal,
          },
        },
        $inc: { publicFloat: -plan.shares, ...orderFlowInc(plan) },
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
 * Inverse of the corp reserve: returns the shares to the float and restores
 * the average-cost basis by removing exactly this purchase from the live
 * entry (the exact inverse of the weighted-average apply). When the push
 * variant applied, the entry holds exactly this buy and is pulled, leaving
 * no zero-share row behind. A vanished entry means the effect is already
 * gone, so the revert converges.
 */
async function revertCorpReserveKeyed(
  db: Db,
  key: string,
  plan: NormalizedBuyPlan,
  now: Date,
  sessionOpts: MoneyFlowOptions
): Promise<MoneyFlowLegOutcome> {
  const corps = db.collection<BuyCorpAccount>("corporations");
  const live = await corps.findOne({ _id: plan.corpId } as Filter<BuyCorpAccount>, {
    projection: { shareholders: 1 },
    ...(sessionOpts.session ? { session: sessionOpts.session } : {}),
  });
  if (!live) return "missing";
  const entry = findFundEntry(live.shareholders, plan.fundId);
  if (!entry) return "already-applied";
  const reverseInc = {
    publicFloat: Math.min(entry.shares, plan.shares),
    ...(plan.orderFlowEligible ? { orderFlowWindowBuyValue: -plan.issuerCreditLocal } : {}),
  };
  if (entry.shares <= plan.shares) {
    return applyKeyedUpdate(
      key,
      {
        collection: corps,
        filter: { _id: plan.corpId } as Filter<BuyCorpAccount>,
        update: {
          $pull: { shareholders: { fundId: plan.fundId } },
          $inc: reverseInc,
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
        "shareholders.fundId": plan.fundId,
      } as Filter<BuyCorpAccount>,
      update: {
        $inc: { "shareholders.$.shares": -plan.shares, ...reverseInc },
        $set: { "shareholders.$.avgCostPerShare": restoredAvg, updatedAt: now },
      },
    },
    sessionOpts
  );
}

function makeCorpReserveStep(db: Db, key: string, plan: NormalizedBuyPlan): MoneyFlowStep {
  const subkey = deriveMoneyFlowKey(key, "corp-reserve");
  return {
    name: "corp-reserve",
    apply: (stepOpts) => applyCorpReserveKeyed(db, subkey, plan, plan.now, stepOpts ?? {}),
    revert: (stepOpts) =>
      revertCorpReserveKeyed(
        db,
        deriveMoneyFlowKey(subkey, "compensate", "corp-reserve"),
        plan,
        plan.now,
        stepOpts ?? {}
      ),
  };
}

/**
 * Money-neutral equity-pool shell for the pool route (issue #1672): safe on
 * resumed attempts, moves no cash. The caller only picks the pool route when
 * the pool existed at quote time, so this covers a pool deleted mid-flight
 * the way the legacy upserting credit did.
 */
async function ensureEquityPoolShell(
  db: Db,
  currency: CurrencyCode,
  now: Date,
  sessionOpts: MoneyFlowOptions
): Promise<void> {
  await db.collection<EquityMarketPool>(EQUITY_MARKET_POOLS_COLLECTION).updateOne(
    { _id: currency },
    {
      $set: { updatedAt: now },
      $setOnInsert: { cashLocal: 0, targetCashLocal: 0, lifetime: {}, createdAt: now },
    },
    {
      upsert: true,
      ...(sessionOpts.session ? { session: sessionOpts.session } : {}),
    } as Parameters<Collection<EquityMarketPool>["updateOne"]>[2]
  );
}

/**
 * Issuer-side credit as a revertible money-flow step (issue #1672): the same
 * routing `applyFloatBuyCredit` performs (pool counterparty, escrow-mode
 * issuer, instant-mode issuer with issuance-proceeds tracking), but carrying
 * the flow's idempotency key so a retried buy credits the issuer exactly
 * once. A pool-route apply also advances the caller's preloaded snapshot so
 * later quotes in the same pass see the cash skew, and a revert retreats it.
 * A dust issuer credit that rounds to zero skips the pool write, matching the
 * legacy credit's no-op on non-positive amounts.
 */
function makeIssuerCreditStep(db: Db, key: string, plan: NormalizedBuyPlan): MoneyFlowStep | null {
  const subkey = deriveMoneyFlowKey(key, "issuer-credit");
  if (plan.issuerRoute === "pool") {
    const amount = roundCents(plan.issuerCreditLocal);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const pools = db.collection<MoneyFlowAccount>(EQUITY_MARKET_POOLS_COLLECTION);
    const advanceSnapshot = (sign: 1 | -1): void => {
      const snapshot = plan.pools?.get(plan.currency);
      if (!snapshot) return;
      const stepped = roundCents((snapshot.cashLocal ?? 0) + sign * amount);
      if (Number.isFinite(stepped) && stepped >= 0) snapshot.cashLocal = stepped;
    };
    return {
      name: "issuer-credit",
      apply: async (stepOpts) => {
        const outcome = await applyKeyedUpdate(
          subkey,
          {
            collection: pools,
            filter: { _id: plan.currency } as Filter<MoneyFlowAccount>,
            update: {
              $inc: { cashLocal: amount, "lifetime.purchasesIn": amount },
              $set: { updatedAt: plan.now },
            },
          },
          stepOpts ?? {}
        );
        if (outcome === "applied") advanceSnapshot(1);
        return outcome;
      },
      revert: async (stepOpts) => {
        const outcome = await applyKeyedUpdate(
          deriveMoneyFlowKey(subkey, "compensate", "issuer-credit"),
          {
            collection: pools,
            filter: { _id: plan.currency } as Filter<MoneyFlowAccount>,
            update: {
              $inc: { cashLocal: -amount, "lifetime.purchasesIn": -amount },
              $set: { updatedAt: plan.now },
            },
          },
          stepOpts ?? {}
        );
        if (outcome === "applied") advanceSnapshot(-1);
        return outcome;
      },
    };
  }
  const corps = db.collection<BuyCorpAccount>("corporations");
  if (plan.issuerRoute === "escrow") {
    return makeLegStep(subkey, {
      name: "issuer-credit",
      collection: corps,
      docId: plan.corpId,
      field: "shareEscrowBalance",
      delta: plan.issuerCreditLocal,
      set: { updatedAt: plan.now },
    });
  }
  return makeLegStep(subkey, {
    name: "issuer-credit",
    collection: corps,
    docId: plan.corpId,
    field: "liquidCapital",
    delta: plan.issuerCreditLocal,
    extraIncs: { shareIssuanceProceeds: plan.issuerCreditLocal },
    set: { updatedAt: plan.now },
  });
}

/** Fund holdings image after buying shares (same formula the cron always used). */
function holdingsAfterPurchase(
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
      const newAvg = existing.avgCostPerShareAnchor
        ? (h.shares * h.avgCostPerShareAnchor! + additionalShares * sharePriceAnchor) / newShares
        : sharePriceAnchor;
      return {
        ...h,
        shares: newShares,
        avgCostPerShareAnchor: newAvg,
        lastValueAnchor: (h.lastValueAnchor ?? 0) + additionalShares * sharePriceAnchor,
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

/** Inverse of the holdings write, computed from live state: removes exactly this buy. */
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

interface FundHoldingsAccount extends MoneyFlowAccount {
  holdings?: IndexFundHolding[];
}

/**
 * Fund holdings write as a revertible keyed step (issue #1672): the image is
 * computed from a live read inside the apply and written in one guarded
 * update, so a crash between the read and the write retries from the same
 * live state and converges, and a same-key replay finds its key recorded and
 * skips. The revert removes exactly this buy from the live image, so a later
 * buy for a different corp that landed in between keeps its entry.
 */
function makeFundHoldingsStep(db: Db, key: string, plan: NormalizedBuyPlan): MoneyFlowStep {
  const subkey = deriveMoneyFlowKey(key, "fund-holdings");
  const funds = db.collection<FundHoldingsAccount>("indexFunds");
  const readHoldings = async (
    sessionOpts: MoneyFlowOptions
  ): Promise<IndexFundHolding[] | null> => {
    const live = await funds.findOne({ _id: plan.fundId } as Filter<FundHoldingsAccount>, {
      projection: { holdings: 1 },
      ...(sessionOpts.session ? { session: sessionOpts.session } : {}),
    });
    if (!live) return null;
    return live.holdings ?? [];
  };
  return {
    name: "fund-holdings",
    apply: async (stepOpts) => {
      const opts = stepOpts ?? {};
      const live = await readHoldings(opts);
      if (live === null) return "missing";
      const image = holdingsAfterPurchase(
        live,
        plan.corpId,
        plan.shares,
        plan.executionPriceAnchor
      );
      return applyKeyedUpdate(
        subkey,
        {
          collection: funds,
          filter: { _id: plan.fundId } as Filter<FundHoldingsAccount>,
          update: { $set: { holdings: image, updatedAt: plan.now } },
        },
        opts
      );
    },
    revert: async (stepOpts) => {
      const opts = stepOpts ?? {};
      const live = await readHoldings(opts);
      if (live === null) return "missing";
      const image = holdingsBeforePurchase(
        live,
        plan.corpId,
        plan.shares,
        plan.executionPriceAnchor
      );
      return applyKeyedUpdate(
        deriveMoneyFlowKey(subkey, "compensate", "fund-holdings"),
        {
          collection: funds,
          filter: { _id: plan.fundId } as Filter<FundHoldingsAccount>,
          update: { $set: { holdings: image, updatedAt: plan.now } },
        },
        opts
      );
    },
  };
}

/**
 * Build the ordered keyed steps for a buy attempt. Exported for focused
 * compensation tests: a test can sabotage one step and assert the applied
 * prefix reverses exactly. Production always runs these through
 * `applyFundShareBuySpend` (claim + stored plan + settlement).
 */
export function buildBuySteps(
  db: Db,
  key: string,
  input: FundShareBuySpendInput,
  now: Date
): MoneyFlowStep[] {
  const plan = planFromInput(input, now);
  const funds = db.collection<MoneyFlowAccount>("indexFunds");
  const txs = db.collection<IndexFundTransaction>("indexFundTransactions");

  const debitStep = makeLegStep(key, {
    name: "fund-debit",
    collection: funds,
    docId: plan.fundId,
    field: "cashAnchor",
    delta: -plan.actualCost,
    minBalance: plan.actualCost,
    set: { updatedAt: plan.now },
  });

  const steps: MoneyFlowStep[] = [debitStep, makeCorpReserveStep(db, key, plan)];
  const issuerStep = makeIssuerCreditStep(db, key, plan);
  if (issuerStep) steps.push(issuerStep);
  steps.push(makeFundHoldingsStep(db, key, plan));

  // Terminal: nothing runs after it, so it carries no inverse. A survived
  // insert error compensates the prefix instead of stranding paid cash with
  // no audit row. The `_id` derives from the flow key, so a crash between
  // the insert and the receipt completion converges instead of duplicating
  // the row.
  steps.push(
    makeInsertStep("buy-tx", txs, {
      _id: keyedInsertId(key, TX_INSERT_DOMAIN),
      fundId: plan.fundId,
      kind: "public_float_buy",
      corporationId: plan.corpId,
      shares: plan.shares,
      navAnchor: plan.executionPriceAnchor,
      amountAnchor: plan.actualCost,
      createdAt: plan.now,
    } satisfies IndexFundTransaction)
  );

  return steps;
}

/**
 * Buy shares from the public float on behalf of an index fund so the result
 * is exactly-once on every topology (issue #1672).
 *
 * Step order mirrors the historical write order (fund debit, corp float +
 * fund-shareholder credit, issuer credit, holdings write, transaction row),
 * and a later-step failure compensates its own prefix (issuer un-credit,
 * shares returned to the float, cash refunded, holdings restored) instead of
 * leaving a strand where the fund paid but holds nothing.
 *
 * Fan-out keying: the debit carries the flow key and every later write
 * carries its own idempotent sub-operation key derived via
 * `deriveMoneyFlowKey` (`corp-reserve`, `issuer-credit`, `fund-holdings`
 * suffixes, plus the deterministic audit-row `_id`), so a crash between any
 * two writes resumes per step: applied steps report `already-applied` and
 * are skipped while the rest still land.
 *
 * The caller (the cron pass) owns everything ambient: the pool quote, the FX
 * conversion, the order-flow eligibility read, and the issuer-route decision.
 * Those arrive here as pinned amounts on the input and are persisted on the
 * receipt plan at claim time, so a same-key retry never recomputes them from
 * post-debit state.
 *
 * Under real transactions the debit, the reserve, the issuer credit, the
 * holdings write, the audit row, and the idempotency receipt join the
 * transaction and commit atomically, preserving the old behavior. On a
 * standalone deployment the fallback runs the same writes as keyed
 * idempotent steps: a crash between them leaves an `in_progress` receipt,
 * and retrying with the same key and fingerprint reconciles to exactly one
 * buy. A retry after a terminal failure throws `MoneyFlowTerminalError`
 * (fail closed); a new attempt needs a new key. There is no pass-level
 * orphan driver for buys (unlike queued redemptions, no intent row exists to
 * strand): an unretried partial stays exactly as the crash left it, and the
 * next turn's buys run under new keys.
 */
export async function applyFundShareBuySpend(
  db: Db,
  input: FundShareBuySpendInput
): Promise<{ duplicate: boolean; outcome: FundShareBuyOutcome }> {
  if (!input.fundId) {
    throw new TypeError("Fund share buy needs fundId");
  }
  if (!input.corpId) {
    throw new TypeError("Fund share buy needs corpId");
  }
  if (!Number.isInteger(input.shares) || input.shares <= 0) {
    throw new RangeError("Fund share buy shares must be a positive integer");
  }
  if (!Number.isFinite(input.executionPriceLocal) || input.executionPriceLocal <= 0) {
    throw new RangeError("Fund share buy executionPriceLocal must be a positive finite amount");
  }
  if (!Number.isFinite(input.executionPriceAnchor) || input.executionPriceAnchor <= 0) {
    throw new RangeError("Fund share buy executionPriceAnchor must be a positive finite amount");
  }
  if (!Number.isFinite(input.actualCost) || input.actualCost <= 0) {
    throw new RangeError("Fund share buy actualCost must be a positive finite amount");
  }
  if (!Number.isFinite(input.issuerCreditLocal) || input.issuerCreditLocal < 0) {
    throw new RangeError("Fund share buy issuerCreditLocal must be a finite non-negative amount");
  }
  if (typeof input.currency !== "string" || input.currency.length === 0) {
    throw new TypeError("Fund share buy needs currency");
  }
  if (
    input.issuerRoute !== "pool" &&
    input.issuerRoute !== "escrow" &&
    input.issuerRoute !== "liquid"
  ) {
    throw new TypeError("Fund share buy needs a valid issuerRoute");
  }
  if (!Number.isInteger(input.turn) || input.turn < 0) {
    throw new RangeError("Fund share buy turn must be a non-negative integer");
  }
  if (typeof input.fingerprint !== "string" || input.fingerprint.length === 0) {
    throw new TypeError("Fund share buy needs a non-empty fingerprint");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Fund share buy idempotency key must be 1-128 characters");
  }

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<FundShareBuyReceipt>;
  const now = new Date();

  const persistOutcome = async (
    plan: NormalizedBuyPlan,
    opts: { session?: ClientSession }
  ): Promise<FundShareBuyOutcome> => {
    const outcome = planOutcome(plan);
    await receiptCollection.updateOne(
      { _id: key },
      {
        $set: {
          fundShareBuyPlan: { ...toStoredPlanLike(plan), outcome },
          updatedAt: new Date(),
        },
      },
      opts.session ? { session: opts.session } : {}
    );
    return outcome;
  };

  const runPlan = async (
    plan: NormalizedBuyPlan,
    stepInput: FundShareBuySpendInput,
    opts: { session?: ClientSession }
  ): Promise<FundShareBuyOutcome> => {
    await runMoneyFlowSteps(
      receipts,
      key,
      buildBuySteps(db, key, stepInput, plan.now),
      (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome) => mapBuyError(step.name, outcome),
      opts
    );
    return persistOutcome(plan, opts);
  };

  const storedInput = (
    stored: FundShareBuyStoredPlan,
    pools?: Map<CurrencyCode, EquityMarketPool>
  ): FundShareBuySpendInput => ({
    fundId: new ObjectId(stored.fundIdHex),
    corpId: new ObjectId(stored.corpIdHex),
    shares: stored.shares,
    executionPriceLocal: stored.executionPriceLocal,
    executionPriceAnchor: stored.executionPriceAnchor,
    actualCost: stored.actualCost,
    issuerCreditLocal: stored.issuerCreditLocal,
    orderFlowEligible: stored.orderFlowEligible,
    currency: stored.currency,
    issuerRoute: stored.issuerRoute,
    turn: stored.turn,
    fingerprint: input.fingerprint,
    idempotencyKey: key,
    ...(pools ? { pools } : {}),
  });

  const runSpend = async (
    session?: ClientSession
  ): Promise<{ duplicate: boolean; outcome: FundShareBuyOutcome }> => {
    const opts = session ? { session } : {};
    // Money-neutral pool shell (see ensureEquityPoolShell): safe on resumed
    // attempts, no cash moves. Skipped for a dust credit that rounds to zero,
    // which skips the pool write below exactly like the legacy no-op.
    if (input.issuerRoute === "pool" && roundCents(input.issuerCreditLocal) > 0) {
      await ensureEquityPoolShell(db, input.currency, now, opts);
    }
    let claim: Awaited<ReturnType<typeof claimMoneyFlowReceipt>>;
    try {
      claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    } catch (err) {
      if (!(err instanceof MoneyFlowKeyConflictError)) throw err;
      // Same key, different fingerprint: a genuinely different buy reusing
      // the key, not a post-crash remainder. Fail closed.
      throw err;
    }
    if (claim === "duplicate") {
      const existing = await receiptCollection.findOne({ _id: key }, opts);
      const stored = existing?.fundShareBuyPlan;
      if (!isStoredPlan(stored)) {
        throw new Error("MONEY_FLOW_RECEIPT_LOST");
      }
      return {
        duplicate: true,
        outcome: await persistOutcome(planFromStored(stored, input.pools), opts),
      };
    }
    if (claim === "in-progress") {
      // Same fingerprint, so the live input names the same buy, but the
      // steps run from the STORED plan when one exists, never the live
      // input: post-crash reads are post-debit state and would double-buy or
      // misprice. No stored plan means the crash landed between the claim
      // insert and the plan write below (nothing applied yet), so the live
      // input under the stored fingerprint is exact.
      const existing = await receiptCollection.findOne({ _id: key }, opts);
      const stored = existing?.fundShareBuyPlan;
      if (isStoredPlan(stored)) {
        const plan = planFromStored(stored, input.pools);
        const outcome = await runPlan(plan, storedInput(stored, input.pools), opts);
        return { duplicate: true, outcome };
      }
      const plan = planFromInput(input, now);
      const outcome = await runPlan(plan, input, opts);
      return { duplicate: true, outcome };
    }
    // A fresh claim owns the attempt. Persist the resume plan before the
    // first step: a crash from here on resumes this exact plan under the same
    // key.
    try {
      await receiptCollection.updateOne(
        { _id: key },
        { $set: { fundShareBuyPlan: toStoredPlan(input, now), updatedAt: new Date() } },
        opts
      );
    } catch (planError) {
      await failMoneyFlowReceipt(receipts, key, `${FUND_SHARE_BUY_TX}:plan-store`, opts);
      throw planError;
    }

    const plan = planFromInput(input, now);
    const outcome = await runPlan(plan, input, opts);
    return { duplicate: false, outcome };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}

/** Rebuild a storable plan snapshot from a normalized plan (for outcome writes). */
function toStoredPlanLike(plan: NormalizedBuyPlan): FundShareBuyStoredPlan {
  return {
    version: 1,
    fundIdHex: plan.fundId.toHexString(),
    corpIdHex: plan.corpId.toHexString(),
    shares: plan.shares,
    executionPriceLocal: plan.executionPriceLocal,
    executionPriceAnchor: plan.executionPriceAnchor,
    actualCost: plan.actualCost,
    issuerCreditLocal: plan.issuerCreditLocal,
    orderFlowEligible: plan.orderFlowEligible,
    currency: plan.currency,
    issuerRoute: plan.issuerRoute,
    turn: plan.turn,
    nowIso: plan.now.toISOString(),
    ...(plan.outcome ? { outcome: { ...plan.outcome } } : {}),
  };
}
