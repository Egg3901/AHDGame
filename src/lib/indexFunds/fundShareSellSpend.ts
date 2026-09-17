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
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { IndexFundHolding, IndexFundTransaction, Shareholder } from "@/lib/db/types";

/**
 * Fund holdings image after selling shares (the same formula the sale
 * always used). Shared with the redemption pass, which plans from it.
 */
export function updateHoldingAfterSale(
  holdings: IndexFundHolding[],
  corporationId: ObjectId,
  sharesSold: number,
  sharePriceAnchor: number
): IndexFundHolding[] {
  return holdings
    .map((h) => {
      if (h.corporationId.toString() !== corporationId.toString()) return h;
      const newShares = h.shares - sharesSold;
      if (newShares <= 0) return null;
      return {
        ...h,
        shares: newShares,
        lastValueAnchor: newShares * sharePriceAnchor,
      };
    })
    .filter((h): h is IndexFundHolding => h !== null);
}

/** Issuer debit lost its race (pool drained, escrow floor moved, treasury short): caller skips the sale. */
export const FUND_SHARE_SELL_ISSUER = "FUND_SHARE_SELL_ISSUER";
/** Corp float/shareholder write lost its race: caller skips the sale (prefix compensated). */
export const FUND_SHARE_SELL_RELEASE = "FUND_SHARE_SELL_RELEASE";
/** Fund credit failed after money moved: prefix compensated, caller treats as pathological. */
export const FUND_SHARE_SELL_CREDIT = "FUND_SHARE_SELL_CREDIT";
/** Fund holdings write failed after money moved: prefix compensated, caller treats as pathological. */
export const FUND_SHARE_SELL_HOLDINGS = "FUND_SHARE_SELL_HOLDINGS";
/** Sale audit-row insert failed after money moved: prefix compensated, caller retries next turn. */
export const FUND_SHARE_SELL_TX = "FUND_SHARE_SELL_TX";

/** Domain for the deterministic sale audit-row `_id` derived from the flow key. */
const TX_INSERT_DOMAIN = "indexfund-share-sell-tx";

/** Where the issuer side of a float sale settles. Pinned by the caller at quote time. */
export type FundShareSellIssuerRoute = "pool" | "escrow" | "liquid";

/** Who funds the issuer side of the sale. Pinned by the caller at quote time. */
export type FundShareSellCounterparty = "market" | "issuer";

export interface FundShareSellSpendInput {
  fundId: ObjectId;
  corpId: ObjectId;
  /** Whole shares sold back into the public float. */
  sharesToSell: number;
  /** Executable bid in the corp local currency (pool quote or fair mid). */
  executionPriceLocal: number;
  /** Anchor value of one share at the execution price (caller FX reference). */
  pricePerShareAnchor: number;
  /** Anchor credited to the fund (rounded cents, may be zero for dust). */
  proceedsAnchor: number;
  /** Local-currency issuer debit (`sharesToSell` x `executionPriceLocal`, raw). */
  issuerDebitLocal: number;
  /** Escrow share of the issuer debit (escrow route only, pinned from pre-state). */
  escrowDebited: number;
  /** Treasury share of the issuer debit (escrow route only, pinned from pre-state). */
  treasuryDebited: number;
  /** Whether the legacy order-flow window tally applies to this corp. */
  orderFlowEligible: boolean;
  /** Pool currency the issuer debit settles in (pool route). */
  currency: CurrencyCode;
  /** Issuer settlement route, resolved by the caller exactly like `settleFloatSellDebit`. */
  issuerRoute: FundShareSellIssuerRoute;
  /** Issuer-side funder, resolved by the caller exactly like `settleFloatSellDebit`. */
  counterparty: FundShareSellCounterparty;
  /** Average anchor cost of the holding being sold (null when the row carries none). */
  holdingAvgCostAnchor: number | null;
  /** Audit note for the sale transaction row. */
  note: string;
  /** Cron turn, for keying. */
  turn: number;
  /**
   * Caller-chosen fingerprint of the intended sale (see
   * `buildFundShareSellFingerprint`). A retry with the same key and
   * fingerprint reconciles the stored plan; a different fingerprint is a
   * different sale and stays a `MoneyFlowKeyConflictError`.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key. The pass derives one per fund, corp,
   * and share count (see `buildFundShareSellKey`) so a same-key retry
   * resumes instead of double-selling. Omit to mint one: the attempt is still
   * crash-safe within itself, but a client retry mints a new key and is
   * treated as a new sale (still guarded by the keyed steps).
   */
  idempotencyKey?: string;
}

/**
 * Deterministic idempotency key for one float sale: the pass sells at most
 * one leg per corp per attempt, so fund + corp + turn + shares names the
 * attempt. A same-key retry (crash recovery, same-turn double-fire)
 * reuses it and reconciles; a recomputed different-size sale gets a new key
 * and runs as a fresh guarded attempt.
 */
export function buildFundShareSellKey(
  fundId: ObjectId,
  corpId: ObjectId,
  turn: number,
  sharesToSell: number
): string {
  return `fund-share-sell:${fundId.toHexString()}:${corpId.toHexString()}:turn:${turn}:shares:${sharesToSell}`;
}

/**
 * Deterministic fingerprint for one float-sale attempt. Covers the operation
 * identity (fund, corp, turn) plus every pinned amount, the escrow split,
 * the issuer route and counterparty, and the audit note, so a key reused
 * for a different sale fails closed instead of replaying the wrong outcome.
 */
export function buildFundShareSellFingerprint(input: {
  fundId: ObjectId;
  corpId: ObjectId;
  sharesToSell: number;
  executionPriceLocal: number;
  pricePerShareAnchor: number;
  proceedsAnchor: number;
  issuerDebitLocal: number;
  escrowDebited: number;
  treasuryDebited: number;
  orderFlowEligible: boolean;
  currency: string;
  issuerRoute: FundShareSellIssuerRoute;
  counterparty: FundShareSellCounterparty;
  holdingAvgCostAnchor: number | null;
  note: string;
  turn: number;
}): string {
  const cents = (n: number): string => String(Math.round(n * 100) / 100);
  return [
    "fund-share-sell",
    input.fundId.toHexString(),
    input.corpId.toHexString(),
    `shares:${input.sharesToSell}`,
    `price:${cents(input.executionPriceLocal)}`,
    `priceAnchor:${cents(input.pricePerShareAnchor)}`,
    `proceeds:${cents(input.proceedsAnchor)}`,
    `issuer:${cents(input.issuerDebitLocal)}`,
    `escrow:${cents(input.escrowDebited)}`,
    `treasury:${cents(input.treasuryDebited)}`,
    `orderflow:${input.orderFlowEligible ? "yes" : "no"}`,
    `ccy:${input.currency}`,
    `route:${input.issuerRoute}`,
    `counterparty:${input.counterparty}`,
    `avg:${input.holdingAvgCostAnchor === null ? "none" : cents(input.holdingAvgCostAnchor)}`,
    `note:${input.note}`,
    `turn:${input.turn}`,
  ].join(":");
}

/** Stored sale numbers, written post-commit so a replay reports stably. */
export interface FundShareSellOutcome {
  sharesSold: number;
  cashRaisedAnchor: number;
}

export function isFundShareSellOutcome(value: unknown): value is FundShareSellOutcome {
  if (!value || typeof value !== "object") return false;
  const outcome = value as Record<string, unknown>;
  return typeof outcome.sharesSold === "number" && typeof outcome.cashRaisedAnchor === "number";
}

/**
 * Crash-resume plan persisted on the flow receipt right after the fresh
 * claim, before any money moves. A same-key retry after a crash rebuilds its
 * steps from THIS plan, never from the caller's live input: the pass prices
 * every sale from live pool quotes, so post-crash input is computed from
 * post-debit reads and running it would double-sell or misprice. Resuming
 * the stored plan keeps the issuer debit, the corp release, the fund credit,
 * the holdings write, and every compensation inverse at exactly the
 * attempted amounts.
 */
export interface FundShareSellStoredPlan {
  version: 1;
  fundIdHex: string;
  corpIdHex: string;
  sharesToSell: number;
  executionPriceLocal: number;
  pricePerShareAnchor: number;
  proceedsAnchor: number;
  issuerDebitLocal: number;
  escrowDebited: number;
  treasuryDebited: number;
  orderFlowEligible: boolean;
  currency: CurrencyCode;
  issuerRoute: FundShareSellIssuerRoute;
  counterparty: FundShareSellCounterparty;
  holdingAvgCostAnchor: number | null;
  note: string;
  turn: number;
  nowIso: string;
  outcome?: FundShareSellOutcome;
}

function toStoredPlan(input: FundShareSellSpendInput, now: Date): FundShareSellStoredPlan {
  return {
    version: 1,
    fundIdHex: input.fundId.toHexString(),
    corpIdHex: input.corpId.toHexString(),
    sharesToSell: input.sharesToSell,
    executionPriceLocal: input.executionPriceLocal,
    pricePerShareAnchor: input.pricePerShareAnchor,
    proceedsAnchor: input.proceedsAnchor,
    issuerDebitLocal: input.issuerDebitLocal,
    escrowDebited: input.escrowDebited,
    treasuryDebited: input.treasuryDebited,
    orderFlowEligible: input.orderFlowEligible,
    currency: input.currency,
    issuerRoute: input.issuerRoute,
    counterparty: input.counterparty,
    holdingAvgCostAnchor: input.holdingAvgCostAnchor,
    note: input.note,
    turn: input.turn,
    nowIso: now.toISOString(),
  };
}

function isStoredPlan(value: unknown): value is FundShareSellStoredPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.version === 1 &&
    typeof plan.fundIdHex === "string" &&
    typeof plan.corpIdHex === "string" &&
    typeof plan.currency === "string" &&
    (plan.issuerRoute === "pool" ||
      plan.issuerRoute === "escrow" ||
      plan.issuerRoute === "liquid") &&
    (plan.counterparty === "market" || plan.counterparty === "issuer")
  );
}

/** Receipt rows carry the resume plan under this field (never in the shared type). */
type FundShareSellReceipt = MoneyFlowReceipt & { fundShareSellPlan?: unknown };

interface NormalizedSellPlan {
  fundId: ObjectId;
  corpId: ObjectId;
  sharesToSell: number;
  executionPriceLocal: number;
  pricePerShareAnchor: number;
  proceedsAnchor: number;
  issuerDebitLocal: number;
  escrowDebited: number;
  treasuryDebited: number;
  orderFlowEligible: boolean;
  currency: CurrencyCode;
  issuerRoute: FundShareSellIssuerRoute;
  counterparty: FundShareSellCounterparty;
  holdingAvgCostAnchor: number | null;
  note: string;
  turn: number;
  now: Date;
  outcome?: FundShareSellOutcome;
}

function planFromInput(live: FundShareSellSpendInput, now: Date): NormalizedSellPlan {
  return {
    fundId: live.fundId,
    corpId: live.corpId,
    sharesToSell: live.sharesToSell,
    executionPriceLocal: live.executionPriceLocal,
    pricePerShareAnchor: live.pricePerShareAnchor,
    proceedsAnchor: live.proceedsAnchor,
    issuerDebitLocal: live.issuerDebitLocal,
    escrowDebited: live.escrowDebited,
    treasuryDebited: live.treasuryDebited,
    orderFlowEligible: live.orderFlowEligible,
    currency: live.currency,
    issuerRoute: live.issuerRoute,
    counterparty: live.counterparty,
    holdingAvgCostAnchor: live.holdingAvgCostAnchor,
    note: live.note,
    turn: live.turn,
    now,
  };
}

function planFromStored(stored: FundShareSellStoredPlan): NormalizedSellPlan {
  return {
    fundId: new ObjectId(stored.fundIdHex),
    corpId: new ObjectId(stored.corpIdHex),
    sharesToSell: stored.sharesToSell,
    executionPriceLocal: stored.executionPriceLocal,
    pricePerShareAnchor: stored.pricePerShareAnchor,
    proceedsAnchor: stored.proceedsAnchor,
    issuerDebitLocal: stored.issuerDebitLocal,
    escrowDebited: stored.escrowDebited,
    treasuryDebited: stored.treasuryDebited,
    orderFlowEligible: stored.orderFlowEligible,
    currency: stored.currency,
    issuerRoute: stored.issuerRoute,
    counterparty: stored.counterparty,
    holdingAvgCostAnchor: stored.holdingAvgCostAnchor,
    note: stored.note,
    turn: stored.turn,
    now: new Date(stored.nowIso),
    outcome:
      stored.outcome && isFundShareSellOutcome(stored.outcome) ? { ...stored.outcome } : undefined,
  };
}

function planOutcome(plan: NormalizedSellPlan): FundShareSellOutcome {
  if (plan.outcome) return { ...plan.outcome };
  // A completed receipt always carries the stored outcome; this fallback only
  // runs when the process crashed between settling `completed` and writing
  // the outcome row. Every number is pinned in the plan, so no live read is
  // needed and the report is exactly the attempted sale.
  return { sharesSold: plan.sharesToSell, cashRaisedAnchor: plan.proceedsAnchor };
}

function mapSellError(stepName: string, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical surface: a lost issuer race reports a plain
  // failure (the old settlement returned null and the caller skipped), a
  // lost float race reports a plain failure after the prefix compensates
  // (the old code reversed the issuer debit and skipped), and anything later
  // is pathological (the legacy sequential writes had no recovery there
  // either, so the compensated prefix plus a throw is strictly safer).
  if (stepName === "issuer-debit") return new Error(`${FUND_SHARE_SELL_ISSUER}:${outcome}`);
  if (stepName === "corp-release") return new Error(`${FUND_SHARE_SELL_RELEASE}:${outcome}`);
  if (stepName === "fund-credit") return new Error(`${FUND_SHARE_SELL_CREDIT}:${outcome}`);
  if (stepName === "fund-holdings") return new Error(`${FUND_SHARE_SELL_HOLDINGS}:${outcome}`);
  return new Error(`${FUND_SHARE_SELL_TX}:${outcome}`);
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Corporation document shape touched by the sale steps. */
interface SellCorpAccount extends MoneyFlowAccount {
  publicFloat?: number;
  shareholders?: Shareholder[];
  orderFlowWindowSellValue?: number;
  liquidCapital?: number;
  shareIssuanceProceeds?: number;
  shareEscrowBalance?: number;
}

function orderFlowInc(plan: NormalizedSellPlan): Record<string, number> {
  return plan.orderFlowEligible
    ? { orderFlowWindowSellValue: plan.sharesToSell * plan.executionPriceLocal }
    : {};
}

function orderFlowDec(plan: NormalizedSellPlan): Record<string, number> {
  return plan.orderFlowEligible
    ? { orderFlowWindowSellValue: -(plan.sharesToSell * plan.executionPriceLocal) }
    : {};
}

/**
 * Issuer-side debit as a revertible money-flow step (issue #1672): the same
 * routing `settleFloatSellDebit` performs (pool counterparty, escrow-mode
 * issuer, instant-mode issuer with issuance-proceeds capture), but carrying
 * the flow's idempotency key so a retried sale debits the issuer exactly
 * once.
 *
 * - Pool: the gated `$gte` debit `debitEquityPoolGated` performs, with the
 *   same cents rounding. A dust debit that rounds to zero carries no step,
 *   matching the legacy no-op.
 * - Escrow: the floored `debitCorpShareEscrowFloored` split, but with the
 *   escrow/treasury shares pinned by the caller from quote-time pre-state
 *   (the split has to be durable before the first mutable leg so the revert
 *   restores it exactly). The escrow guard reproduces the legacy floor: when
 *   concurrent escrow movement breaks the pinned split the step reports a
 *   lost race and the caller skips, where the legacy code would have spilled
 *   more onto the treasury. Fail closed, never over-debit.
 * - Liquid: the guarded treasury debit `atomicallyDebitCorpLiquidCapital`
 *   performs, with the issuance-proceeds capture `onFloatSellCommitted`
 *   performs folded into the same atomic write (extraIncs), exactly like the
 *   buy side folds it into the issuer credit. The legacy code ran the two
 *   writes back to back; the net effect is identical and the revert restores
 *   both together.
 */
function makeIssuerDebitStep(db: Db, key: string, plan: NormalizedSellPlan): MoneyFlowStep | null {
  const subkey = deriveMoneyFlowKey(key, "issuer-debit");
  if (plan.issuerRoute === "pool") {
    const amount = roundCents(plan.issuerDebitLocal);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const pools = db.collection<MoneyFlowAccount>(EQUITY_MARKET_POOLS_COLLECTION);
    return {
      name: "issuer-debit",
      apply: (stepOpts) =>
        applyKeyedUpdate(
          subkey,
          {
            collection: pools,
            filter: { _id: plan.currency, cashLocal: { $gte: amount } } as Filter<MoneyFlowAccount>,
            update: {
              $inc: { cashLocal: -amount, "lifetime.salesOut": amount },
              $set: { updatedAt: plan.now },
            },
          },
          stepOpts ?? {}
        ),
      revert: (stepOpts) =>
        applyKeyedUpdate(
          deriveMoneyFlowKey(subkey, "compensate", "issuer-debit"),
          {
            collection: pools,
            filter: { _id: plan.currency } as Filter<MoneyFlowAccount>,
            update: {
              $inc: { cashLocal: amount, "lifetime.salesOut": -amount },
              $set: { updatedAt: plan.now },
            },
          },
          stepOpts ?? {}
        ),
    };
  }
  const corps = db.collection<SellCorpAccount>("corporations");
  if (plan.issuerRoute === "escrow") {
    const incs: Record<string, number> = {};
    if (plan.escrowDebited > 0) incs.shareEscrowBalance = -plan.escrowDebited;
    if (plan.treasuryDebited > 0) incs.liquidCapital = -plan.treasuryDebited;
    if (Object.keys(incs).length === 0) return null;
    const reverse: Record<string, number> = {};
    if (plan.escrowDebited > 0) reverse.shareEscrowBalance = plan.escrowDebited;
    if (plan.treasuryDebited > 0) reverse.liquidCapital = plan.treasuryDebited;
    return {
      name: "issuer-debit",
      apply: (stepOpts) =>
        applyKeyedUpdate(
          subkey,
          {
            collection: corps,
            filter: {
              _id: plan.corpId,
              ...(plan.escrowDebited > 0
                ? { shareEscrowBalance: { $gte: plan.escrowDebited } }
                : {}),
            } as Filter<SellCorpAccount>,
            update: { $inc: incs, $set: { updatedAt: plan.now } },
          },
          stepOpts ?? {}
        ),
      revert: (stepOpts) =>
        applyKeyedUpdate(
          deriveMoneyFlowKey(subkey, "compensate", "issuer-debit"),
          {
            collection: corps,
            filter: { _id: plan.corpId } as Filter<SellCorpAccount>,
            update: { $inc: reverse, $set: { updatedAt: plan.now } },
          },
          stepOpts ?? {}
        ),
    };
  }
  return makeLegStep(subkey, {
    name: "issuer-debit",
    collection: corps,
    docId: plan.corpId,
    field: "liquidCapital",
    delta: -plan.issuerDebitLocal,
    minBalance: plan.issuerDebitLocal,
    extraIncs: { shareIssuanceProceeds: -plan.issuerDebitLocal },
    set: { updatedAt: plan.now },
  });
}

/**
 * Keyed corp float + shareholder release (issue #1672): the same guarded
 * `$inc` pair `debitSharesFromFund` performs with `requireSufficient` (same
 * `$elemMatch` sufficiency guard, same public-float credit, same
 * order-flow tally), carrying the flow's idempotency key so a retried sale
 * releases the shares exactly once. The legacy zero-share row pull stays out
 * of the flow: it runs post-commit as best effort (a concurrent re-buy that
 * lands in between keeps its row, where the legacy pull would have removed
 * it).
 */
function makeCorpReleaseStep(db: Db, key: string, plan: NormalizedSellPlan): MoneyFlowStep {
  const subkey = deriveMoneyFlowKey(key, "corp-release");
  const corps = db.collection<SellCorpAccount>("corporations");
  return {
    name: "corp-release",
    apply: (stepOpts) =>
      applyKeyedUpdate(
        subkey,
        {
          collection: corps,
          filter: {
            _id: plan.corpId,
            shareholders: {
              $elemMatch: { fundId: plan.fundId, shares: { $gte: plan.sharesToSell } },
            },
          } as Filter<SellCorpAccount>,
          update: {
            $inc: {
              "shareholders.$.shares": -plan.sharesToSell,
              publicFloat: plan.sharesToSell,
              ...orderFlowInc(plan),
            },
            $set: { updatedAt: plan.now },
          },
        },
        stepOpts ?? {}
      ),
    revert: (stepOpts) =>
      applyKeyedUpdate(
        deriveMoneyFlowKey(subkey, "compensate", "corp-release"),
        {
          collection: corps,
          filter: {
            _id: plan.corpId,
            shareholders: { $elemMatch: { fundId: plan.fundId } },
          } as Filter<SellCorpAccount>,
          update: {
            $inc: {
              "shareholders.$.shares": plan.sharesToSell,
              publicFloat: -plan.sharesToSell,
              ...orderFlowDec(plan),
            },
            $set: { updatedAt: plan.now },
          },
        },
        stepOpts ?? {}
      ),
  };
}

/**
 * Fund cash credit as a revertible leg (issue #1672): the `$inc` the legacy
 * sale performed, carrying the flow key so a retried sale credits the fund
 * exactly once. A dust credit that rounds the proceeds to zero carries no
 * step, matching the legacy no-op credit.
 */
function makeFundCreditStep(db: Db, key: string, plan: NormalizedSellPlan): MoneyFlowStep | null {
  if (!Number.isFinite(plan.proceedsAnchor) || plan.proceedsAnchor === 0) return null;
  const funds = db.collection<MoneyFlowAccount>("indexFunds");
  return makeLegStep(key, {
    name: "fund-credit",
    collection: funds,
    docId: plan.fundId,
    field: "cashAnchor",
    delta: plan.proceedsAnchor,
    set: { updatedAt: plan.now },
  });
}

/** Inverse of the holdings write, computed from live state: restores exactly this sale. */
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

interface FundHoldingsAccount extends MoneyFlowAccount {
  holdings?: IndexFundHolding[];
}

/**
 * Fund holdings write as a revertible keyed step (issue #1672): the image is
 * computed from a live read inside the apply with the same
 * `updateHoldingAfterSale` formula the legacy sale always used, and written
 * in one guarded update, so a crash between the read and the write retries
 * from the same live state and converges, and a same-key replay finds its
 * key recorded and skips. The revert restores exactly this sale from the
 * live image, so a later sale for a different corp that landed in between
 * keeps its entry.
 */
function makeFundHoldingsStep(db: Db, key: string, plan: NormalizedSellPlan): MoneyFlowStep {
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
      const image = updateHoldingAfterSale(
        live,
        plan.corpId,
        plan.sharesToSell,
        plan.pricePerShareAnchor
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
      const image = holdingsBeforeSale(
        live,
        plan.corpId,
        plan.sharesToSell,
        plan.pricePerShareAnchor,
        plan.holdingAvgCostAnchor
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
 * Build the ordered keyed steps for a sale attempt. Exported for focused
 * compensation tests: a test can sabotage one step and assert the applied
 * prefix reverses exactly. Production always runs these through
 * `applyFundShareSellSpend` (claim + stored plan + settlement).
 */
export function buildSellSteps(
  db: Db,
  key: string,
  input: FundShareSellSpendInput,
  now: Date
): MoneyFlowStep[] {
  const plan = planFromInput(input, now);
  const txs = db.collection<IndexFundTransaction>("indexFundTransactions");

  const steps: MoneyFlowStep[] = [];
  const issuerStep = makeIssuerDebitStep(db, key, plan);
  if (issuerStep) steps.push(issuerStep);
  steps.push(makeCorpReleaseStep(db, key, plan));
  const creditStep = makeFundCreditStep(db, key, plan);
  if (creditStep) steps.push(creditStep);
  steps.push(makeFundHoldingsStep(db, key, plan));

  // Terminal: nothing runs after it, so it carries no inverse. A survived
  // insert error compensates the prefix instead of stranding moved money
  // with no audit row. The `_id` derives from the flow key, so a crash
  // between the insert and the receipt completion converges instead of
  // duplicating the row.
  steps.push(
    makeInsertStep("sell-tx", txs, {
      _id: keyedInsertId(key, TX_INSERT_DOMAIN),
      fundId: plan.fundId,
      kind: "public_float_sell",
      corporationId: plan.corpId,
      shares: plan.sharesToSell,
      navAnchor: plan.pricePerShareAnchor,
      amountAnchor: plan.proceedsAnchor,
      note: plan.note,
      createdAt: plan.now,
    } satisfies IndexFundTransaction)
  );

  return steps;
}

/**
 * Sell fund-held shares back into the public float on behalf of an index
 * fund so the result is exactly-once on every topology (issue #1672).
 *
 * Step order mirrors the historical write order (issuer debit, corp float +
 * fund-shareholder release, fund credit, holdings write, transaction row),
 * and a later-step failure compensates its own prefix (cash refunded to the
 * issuer, shares returned to the fund, holdings restored) instead of
 * leaving a strand where the fund sold but holds no cash.
 *
 * Fan-out keying: every write carries its own idempotent sub-operation key
 * derived via `deriveMoneyFlowKey` (`issuer-debit`, `corp-release`,
 * `fund-holdings` suffixes, the fund credit on the flow key, plus the
 * deterministic audit-row `_id`), so a crash between any two writes resumes
 * per step: applied steps report `already-applied` and are skipped while
 * the rest still land.
 *
 * The caller (the sale shell or the redemption pass) owns everything
 * ambient: the bid quote, the FX conversion, the order-flow eligibility
 * read, the issuer-route decision, and the escrow split. Those arrive here
 * as pinned amounts on the input and are persisted on the receipt plan at
 * claim time, so a same-key retry never recomputes them from post-debit
 * state.
 *
 * Under real transactions the debit, the release, the credit, the holdings
 * write, the audit row, and the idempotency receipt join the caller's
 * transaction and commit atomically, preserving the old behavior. On a
 * standalone deployment the fallback runs the same writes as keyed
 * idempotent steps: a crash between them leaves an `in_progress` receipt,
 * and retrying with the same key and fingerprint reconciles to exactly one
 * sale. A retry after a terminal failure throws `MoneyFlowTerminalError`
 * (fail closed); a new attempt needs a new key. Pass-level replays reuse
 * the stored plan (see `sellFundHoldingsForRedemptionCash`); there is no
 * separate orphan driver for sales (like buys, no intent row exists to
 * strand): an unretried partial stays exactly as the crash left it, and the
 * next invocation measures its need from live cash.
 */
export async function applyFundShareSellSpend(
  db: Db,
  input: FundShareSellSpendInput,
  opts?: MoneyFlowOptions
): Promise<{ duplicate: boolean; outcome: FundShareSellOutcome }> {
  if (!input.fundId) {
    throw new TypeError("Fund share sale needs fundId");
  }
  if (!input.corpId) {
    throw new TypeError("Fund share sale needs corpId");
  }
  if (!Number.isInteger(input.sharesToSell) || input.sharesToSell <= 0) {
    throw new RangeError("Fund share sale sharesToSell must be a positive integer");
  }
  if (!Number.isFinite(input.executionPriceLocal) || input.executionPriceLocal <= 0) {
    throw new RangeError("Fund share sale executionPriceLocal must be a positive finite amount");
  }
  if (!Number.isFinite(input.pricePerShareAnchor) || input.pricePerShareAnchor <= 0) {
    throw new RangeError("Fund share sale pricePerShareAnchor must be a positive finite amount");
  }
  if (!Number.isFinite(input.proceedsAnchor) || input.proceedsAnchor < 0) {
    throw new RangeError("Fund share sale proceedsAnchor must be a finite non-negative amount");
  }
  if (!Number.isFinite(input.issuerDebitLocal) || input.issuerDebitLocal <= 0) {
    throw new RangeError("Fund share sale issuerDebitLocal must be a positive finite amount");
  }
  if (!Number.isFinite(input.escrowDebited) || input.escrowDebited < 0) {
    throw new RangeError("Fund share sale escrowDebited must be a finite non-negative amount");
  }
  if (!Number.isFinite(input.treasuryDebited) || input.treasuryDebited < 0) {
    throw new RangeError("Fund share sale treasuryDebited must be a finite non-negative amount");
  }
  if (
    input.issuerRoute === "escrow" &&
    Math.abs(input.escrowDebited + input.treasuryDebited - input.issuerDebitLocal) > 1e-6
  ) {
    throw new RangeError("Fund share sale escrow split must sum to the issuer debit");
  }
  if (typeof input.orderFlowEligible !== "boolean") {
    throw new TypeError("Fund share sale needs orderFlowEligible");
  }
  if (typeof input.currency !== "string" || input.currency.length === 0) {
    throw new TypeError("Fund share sale needs currency");
  }
  if (
    input.issuerRoute !== "pool" &&
    input.issuerRoute !== "escrow" &&
    input.issuerRoute !== "liquid"
  ) {
    throw new TypeError("Fund share sale needs a valid issuerRoute");
  }
  if (input.counterparty !== "market" && input.counterparty !== "issuer") {
    throw new TypeError("Fund share sale needs a valid counterparty");
  }
  if (
    input.holdingAvgCostAnchor !== null &&
    (!Number.isFinite(input.holdingAvgCostAnchor) || input.holdingAvgCostAnchor < 0)
  ) {
    throw new RangeError(
      "Fund share sale holdingAvgCostAnchor must be null or a finite non-negative amount"
    );
  }
  if (typeof input.note !== "string") {
    throw new TypeError("Fund share sale needs a note string");
  }
  if (!Number.isInteger(input.turn) || input.turn < 0) {
    throw new RangeError("Fund share sale turn must be a non-negative integer");
  }
  if (typeof input.fingerprint !== "string" || input.fingerprint.length === 0) {
    throw new TypeError("Fund share sale needs a non-empty fingerprint");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Fund share sale idempotency key must be 1-128 characters");
  }

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<FundShareSellReceipt>;
  const now = new Date();

  const persistOutcome = async (
    plan: NormalizedSellPlan,
    stepOpts: { session?: ClientSession }
  ): Promise<FundShareSellOutcome> => {
    const outcome = planOutcome(plan);
    await receiptCollection.updateOne(
      { _id: key },
      {
        $set: {
          fundShareSellPlan: { ...toStoredPlanLike(plan), outcome },
          updatedAt: new Date(),
        },
      },
      stepOpts.session ? { session: stepOpts.session } : {}
    );
    return outcome;
  };

  const runPlan = async (
    plan: NormalizedSellPlan,
    stepInput: FundShareSellSpendInput,
    stepOpts: { session?: ClientSession }
  ): Promise<FundShareSellOutcome> => {
    await runMoneyFlowSteps(
      receipts,
      key,
      buildSellSteps(db, key, stepInput, plan.now),
      (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome) => mapSellError(step.name, outcome),
      stepOpts
    );
    return persistOutcome(plan, stepOpts);
  };

  const storedInput = (stored: FundShareSellStoredPlan): FundShareSellSpendInput => ({
    fundId: new ObjectId(stored.fundIdHex),
    corpId: new ObjectId(stored.corpIdHex),
    sharesToSell: stored.sharesToSell,
    executionPriceLocal: stored.executionPriceLocal,
    pricePerShareAnchor: stored.pricePerShareAnchor,
    proceedsAnchor: stored.proceedsAnchor,
    issuerDebitLocal: stored.issuerDebitLocal,
    escrowDebited: stored.escrowDebited,
    treasuryDebited: stored.treasuryDebited,
    orderFlowEligible: stored.orderFlowEligible,
    currency: stored.currency,
    issuerRoute: stored.issuerRoute,
    counterparty: stored.counterparty,
    holdingAvgCostAnchor: stored.holdingAvgCostAnchor,
    note: stored.note,
    turn: stored.turn,
    fingerprint: input.fingerprint,
    idempotencyKey: key,
  });

  const runSpend = async (
    session?: ClientSession
  ): Promise<{ duplicate: boolean; outcome: FundShareSellOutcome }> => {
    const stepOpts = session ? { session } : {};
    let claim: Awaited<ReturnType<typeof claimMoneyFlowReceipt>>;
    try {
      claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, stepOpts);
    } catch (err) {
      if (!(err instanceof MoneyFlowKeyConflictError)) throw err;
      // Same key, different fingerprint: a genuinely different sale reusing
      // the key, not a post-crash remainder. Fail closed.
      throw err;
    }
    if (claim === "duplicate") {
      const existing = await receiptCollection.findOne({ _id: key }, stepOpts);
      const stored = existing?.fundShareSellPlan;
      if (!isStoredPlan(stored)) {
        throw new Error("MONEY_FLOW_RECEIPT_LOST");
      }
      return {
        duplicate: true,
        outcome: await persistOutcome(planFromStored(stored), stepOpts),
      };
    }
    if (claim === "in-progress") {
      // Same fingerprint, so the live input names the same sale, but the
      // steps run from the STORED plan when one exists, never the live
      // input: post-crash reads are post-debit state and would double-sell
      // or misprice. No stored plan means the crash landed between the claim
      // insert and the plan write below (nothing applied yet), so the live
      // input under the stored fingerprint is exact.
      const existing = await receiptCollection.findOne({ _id: key }, stepOpts);
      const stored = existing?.fundShareSellPlan;
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
        { $set: { fundShareSellPlan: toStoredPlan(input, now), updatedAt: new Date() } },
        stepOpts
      );
    } catch (planError) {
      await failMoneyFlowReceipt(receipts, key, `${FUND_SHARE_SELL_TX}:plan-store`, stepOpts);
      throw planError;
    }

    const plan = planFromInput(input, now);
    const outcome = await runPlan(plan, input, stepOpts);
    return { duplicate: false, outcome };
  };

  // Join the caller's transaction when one is in flight (the redemption
  // route runs the sale inside its payout transaction); otherwise manage our
  // own like every other spend primitive. Never open a nested transaction
  // around an outer session.
  if (opts?.session) return runSpend(opts.session);
  return runWithOptionalTransaction(
    async (session) => runSpend(session ?? undefined),
    async () => runSpend()
  );
}

/** Rebuild a storable plan snapshot from a normalized plan (for outcome writes). */
function toStoredPlanLike(plan: NormalizedSellPlan): FundShareSellStoredPlan {
  return {
    version: 1,
    fundIdHex: plan.fundId.toHexString(),
    corpIdHex: plan.corpId.toHexString(),
    sharesToSell: plan.sharesToSell,
    executionPriceLocal: plan.executionPriceLocal,
    pricePerShareAnchor: plan.pricePerShareAnchor,
    proceedsAnchor: plan.proceedsAnchor,
    issuerDebitLocal: plan.issuerDebitLocal,
    escrowDebited: plan.escrowDebited,
    treasuryDebited: plan.treasuryDebited,
    orderFlowEligible: plan.orderFlowEligible,
    currency: plan.currency,
    issuerRoute: plan.issuerRoute,
    counterparty: plan.counterparty,
    holdingAvgCostAnchor: plan.holdingAvgCostAnchor,
    note: plan.note,
    turn: plan.turn,
    nowIso: plan.now.toISOString(),
    ...(plan.outcome ? { outcome: { ...plan.outcome } } : {}),
  };
}
