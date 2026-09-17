import { ObjectId, type Collection, type Db, type Filter } from "mongodb";
import {
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  deriveMoneyFlowKey,
  failMoneyFlowReceipt,
  keyedInsertId,
  makeLegStep,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
  runMoneyFlowSteps,
  type MoneyFlowLeg,
  type MoneyFlowLegOutcome,
  type MoneyFlowReceipt,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import {
  applyHoldingsCreditKeyed,
  makeCapCreditStep,
  makeCapDebitStep,
  makeCashStep,
  revertHoldingsCreditKeyed,
  type ShareFillCapLeg,
  type ShareFillCashLeg,
} from "@/lib/corporations/commands/shareTrading/shareFillMoney";
import { recordShareTrade } from "@/lib/corporations/shareTradeHistory";
import type { ShareTradeParty } from "@/lib/db/types/shareTradeHistory";
import { EQUITY_MARKET_POOLS_COLLECTION } from "@/lib/db/types/equityMarketPool";
import type { CurrencyCode } from "@/lib/constants/currencies";

/**
 * Durable per-match settlement for the turn limit-order matcher (issue #1672).
 *
 * The matcher (`fillPendingShareOrders`) used to accumulate every fill of the
 * turn into maps and then commit six sequential bulkWrites (pool legs, corp
 * float/shareholder incs, shareholder pushes, character cash, corp payouts,
 * treasury) plus awaited fund dual-ledger writes and best-effort history
 * inserts, with no receipt or resume plan. A crash between any two commits
 * stranded a half-match: orders marked filled with no cash moved, shares
 * moved with no order update, pool debited with nothing else landed.
 *
 * This module settles ONE match (one order's fill at one price) as a keyed
 * money flow and the driver settles matches sequentially in deterministic
 * (price/time-priority) order:
 *
 * - One money receipt per match, keyed
 *   `turn-share-match:<turn>:<orderIdHex>:<preFillRemaining>`. The key pins
 *   the pre-fill remainder, so a same-turn re-run after a completed match
 *   computes a different key for the leftover (a genuinely new fill), while
 *   a re-run before completion reclaims the same key and resumes from the
 *   STORED plan, never from recomputed input.
 * - The immutable resume plan is persisted on the receipt before any match
 *   write. Every id, amount, currency field, conversion result, order
 *   remainder, and display-neutral number is pinned there; recovery never
 *   reprices from post-fill state. FX has no separate write (there is no FX
 *   account): local/anchor conversions are pure arithmetic pinned in the
 *   plan at claim time.
 * - Every leg is a compare-and-set write carrying its subkey, reusing the
 *   green shareFillMoney step builders (cap debit/credit, fund holdings
 *   credit, cash legs) plus match-only legs for the order claim, the float
 *   `$inc`, the pool/treasury dealer leg, and the history insert.
 *   `runMoneyFlowSteps` reverses the applied prefix with keyed inverses
 *   before settling, so a receipt never rests partial.
 * - The history row is the terminal step with a deterministic `_id`
 *   (`keyedInsertId`), pinned `createdAt`, and the same shape
 *   `recordShareTrade` writes on every other path. A survived insert error
 *   reports `guard-rejected` so the prefix compensates (the order reopens
 *   for a later turn) instead of silently dropping audit; a retry converges
 *   on the duplicate `_id`.
 *
 * Behavior notes vs the legacy batch commit: per-match guard failures (pool
 * or treasury short at commit, seller shares raced away) skip that match
 * and continue with the rest instead of throwing away the whole turn's
 * fills; under the turn lock those guards cannot fail, so the no-crash
 * outcome is bit-identical. Cap-table credits blend `avgCostPerShare` on
 * existing entries (the route convention) where the legacy matcher did a
 * bare `$inc`; new-entry stamps are unchanged.
 */

export interface ShareMatchOrderClaim {
  preSharesRemaining: number;
  postSharesRemaining: number;
  preEscrowAmount: number;
  postEscrowAmount: number;
  /** Fund-owned buys only: residual anchor escrow reserved on partial fills. */
  preEscrowAnchor?: number;
  postEscrowAnchor?: number;
  postStatus: "filled" | "open";
}

export type ShareMatchDealerLeg =
  | {
      kind: "pool";
      currency: string;
      /** Rounded local-currency cash movement, signed (buys +, sells -). */
      amountLocal: number;
      flowKind: "purchasesIn" | "salesOut";
    }
  | { kind: "treasury"; amountLocal: number };

export interface ShareMatchHistoryParty {
  characterIdHex?: string;
  corporationIdHex?: string;
  name: string;
}

/**
 * Immutable resume plan for one match. All amounts are final (converted,
 * rounded where the pool convention rounds); execution performs no pricing.
 */
export interface ShareMatchPlan {
  version: 1;
  matchKey: string;
  turn: number;
  nowIso: string;
  orderIdHex: string;
  corpIdHex: string;
  direction: "buy" | "sell";
  shares: number;
  priceLocal: number;
  claim: ShareMatchOrderClaim;
  /** Character seller cap-table debit. Null when placement pre-debited. */
  sellerDebit: ShareFillCapLeg | null;
  /** Buyer cap-table credit (placer on buys). Null on sells (float buys). */
  buyerCredit: ShareFillCapLeg | null;
  /** Fund-buyer holdings credit. Null unless a fund placed a buy. */
  holdingsCredit: { fundIdHex: string; priceAnchor: number } | null;
  /** Proceeds/refund credit. Null when the amount is zero. */
  cashLeg: ShareFillCashLeg | null;
  /** Pool or treasury dealer leg. Null when the amount is zero. */
  dealerLeg: ShareMatchDealerLeg | null;
  /** Signed publicFloat movement (buys -, sells +). Never zero. */
  floatDelta: number;
  history: {
    shares: number;
    priceAnchor: number;
    corpCcy?: CurrencyCode;
    from: ShareMatchHistoryParty | null;
    to: ShareMatchHistoryParty | null;
  };
  outcome?: ShareMatchOutcome;
}

export interface ShareMatchOutcome {
  sharesMoved: number;
}

export function isShareMatchPlan(value: unknown): value is ShareMatchPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.version === 1 &&
    typeof plan.matchKey === "string" &&
    typeof plan.orderIdHex === "string" &&
    typeof plan.corpIdHex === "string" &&
    (plan.direction === "buy" || plan.direction === "sell") &&
    typeof plan.shares === "number" &&
    typeof plan.floatDelta === "number" &&
    plan.claim !== null &&
    typeof plan.claim === "object" &&
    plan.history !== null &&
    typeof plan.history === "object"
  );
}

/** Match receipt key. Pins turn, order, and pre-fill remainder (see above). */
export function buildShareMatchKey(
  turn: number,
  orderIdHex: string,
  preFillRemaining: number
): string {
  return `turn-share-match:${turn}:${orderIdHex}:${preFillRemaining}`;
}

/**
 * Fingerprint covering every pinned number and party, so a key reused for a
 * different fill fails closed instead of replaying the wrong transfer.
 */
export function buildShareMatchFingerprint(plan: ShareMatchPlan): string {
  const cents = (n: number): string => String(Math.round(n * 100) / 100);
  const cash = (leg: ShareFillCashLeg | null): string =>
    leg ? `${leg.collection}:${leg.idHex}:${leg.field}:${cents(leg.amount)}` : "none";
  const cap = (leg: ShareFillCapLeg | null): string =>
    leg ? `${leg.field}:${leg.idHex}:${cents(leg.pricePerShare)}` : "none";
  const party = (p: ShareMatchHistoryParty | null): string =>
    p ? `${p.characterIdHex ?? ""}:${p.corporationIdHex ?? ""}:${p.name}` : "none";
  const dealer = (leg: ShareMatchDealerLeg | null): string =>
    !leg
      ? "none"
      : leg.kind === "pool"
        ? `pool:${leg.currency}:${cents(leg.amountLocal)}:${leg.flowKind}`
        : `treasury:${cents(leg.amountLocal)}`;
  return [
    "turn-share-match",
    plan.corpIdHex,
    plan.orderIdHex,
    plan.direction,
    `shares:${plan.shares}`,
    `price:${cents(plan.priceLocal)}`,
    `claim:${plan.claim.preSharesRemaining}->${plan.claim.postSharesRemaining}:${plan.claim.postStatus}`,
    `sellerDebit:${cap(plan.sellerDebit)}`,
    `buyerCredit:${cap(plan.buyerCredit)}`,
    plan.holdingsCredit
      ? `holdings:${plan.holdingsCredit.fundIdHex}:${cents(plan.holdingsCredit.priceAnchor)}`
      : "holdings:none",
    `cash:${cash(plan.cashLeg)}`,
    `dealer:${dealer(plan.dealerLeg)}`,
    `float:${plan.floatDelta}`,
    `history:${plan.history.shares}:${cents(plan.history.priceAnchor)}:${party(plan.history.from)}:${party(plan.history.to)}`,
    `turn:${plan.turn}`,
  ].join(":");
}

type ShareMatchReceipt = MoneyFlowReceipt & { shareMatchPlan?: unknown };

function receipts(db: Db): Collection<MoneyFlowReceipt> {
  return db.collection<MoneyFlowReceipt>(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION);
}

function receiptsEx(db: Db): Collection<ShareMatchReceipt> {
  return db.collection<ShareMatchReceipt>(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION);
}

function mapMatchError(step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error {
  return new Error(`share-match:${step.name}:${outcome}`);
}

interface OrderAccount {
  _id: ObjectId;
  appliedMoneyFlowKeys?: string[];
}

interface CorpAccount {
  _id: ObjectId;
  appliedMoneyFlowKeys?: string[];
}

interface PoolAccount {
  _id: string;
  appliedMoneyFlowKeys?: string[];
}

/**
 * Conditional order remainder/status advance. The filter pins the exact
 * pre-fill remainder and `open` status, so a retry after the claim applied
 * converges via the key record and a competing fresh fill for the same
 * remainder fails its guard instead of double-filling. The revert restores
 * the pre-claim remainder, escrow, and `open` status, pinned on the
 * post-claim remainder so it cannot undo a later fill.
 */
function makeOrderClaimStep(db: Db, matchKey: string, plan: ShareMatchPlan): MoneyFlowStep {
  const orders = db.collection<OrderAccount>("shareOrders");
  const orderId = new ObjectId(plan.orderIdHex);
  const now = new Date(plan.nowIso);
  const claimSet: Record<string, unknown> = {
    sharesRemaining: plan.claim.postSharesRemaining,
    escrowAmount: plan.claim.postEscrowAmount,
    status: plan.claim.postStatus,
    updatedAt: now,
  };
  if (plan.claim.postEscrowAnchor !== undefined) {
    claimSet.escrowAnchor = plan.claim.postEscrowAnchor;
  }
  const revertSet: Record<string, unknown> = {
    sharesRemaining: plan.claim.preSharesRemaining,
    escrowAmount: plan.claim.preEscrowAmount,
    status: "open",
    updatedAt: now,
  };
  if (plan.claim.preEscrowAnchor !== undefined) {
    revertSet.escrowAnchor = plan.claim.preEscrowAnchor;
  }
  return {
    name: "order-claim",
    apply: () =>
      applyKeyedUpdate(
        deriveMoneyFlowKey(matchKey, "order-claim"),
        {
          collection: orders,
          filter: {
            _id: orderId,
            sharesRemaining: plan.claim.preSharesRemaining,
            status: "open",
          } as Filter<OrderAccount>,
          update: { $set: claimSet },
        },
        {}
      ),
    revert: () =>
      applyKeyedUpdate(
        deriveMoneyFlowKey(matchKey, "compensate", "order-claim"),
        {
          collection: orders,
          filter: {
            _id: orderId,
            sharesRemaining: plan.claim.postSharesRemaining,
          } as Filter<OrderAccount>,
          update: { $set: revertSet },
        },
        {}
      ),
  };
}

function makeDealerStep(db: Db, matchKey: string, plan: ShareMatchPlan): MoneyFlowStep {
  const leg = plan.dealerLeg;
  if (!leg) throw new Error("share-match:dealer-leg-missing");
  const now = new Date(plan.nowIso);
  if (leg.kind === "pool") {
    const pools = db.collection<PoolAccount>(EQUITY_MARKET_POOLS_COLLECTION);
    const poolLeg: MoneyFlowLeg<PoolAccount> = {
      name: "dealer",
      collection: pools,
      docId: leg.currency,
      field: "cashLocal",
      delta: leg.amountLocal,
      ...(leg.amountLocal < 0 ? { minBalance: -leg.amountLocal } : {}),
      extraIncs: { [`lifetime.${leg.flowKind}`]: Math.abs(leg.amountLocal) },
      set: { updatedAt: now },
    };
    return makeLegStep(deriveMoneyFlowKey(matchKey, "dealer"), poolLeg);
  }
  const corps = db.collection<CorpAccount>("corporations");
  const treasuryLeg: MoneyFlowLeg<CorpAccount> = {
    name: "dealer",
    collection: corps,
    docId: new ObjectId(plan.corpIdHex),
    field: "liquidCapital",
    delta: leg.amountLocal,
    ...(leg.amountLocal < 0 ? { minBalance: -leg.amountLocal } : {}),
    set: { updatedAt: now },
  };
  return makeLegStep(deriveMoneyFlowKey(matchKey, "dealer"), treasuryLeg);
}

function makeFloatStep(db: Db, matchKey: string, plan: ShareMatchPlan): MoneyFlowStep {
  const corps = db.collection<CorpAccount>("corporations");
  return makeLegStep(deriveMoneyFlowKey(matchKey, "float"), {
    name: "float",
    collection: corps,
    docId: new ObjectId(plan.corpIdHex),
    field: "publicFloat",
    delta: plan.floatDelta,
    set: { updatedAt: new Date(plan.nowIso) },
  });
}

function toParty(ref: ShareMatchHistoryParty | null): ShareTradeParty | null {
  if (!ref) return null;
  if (ref.characterIdHex) {
    return { characterId: new ObjectId(ref.characterIdHex), name: ref.name };
  }
  if (ref.corporationIdHex) {
    return { corporationId: new ObjectId(ref.corporationIdHex), name: ref.name };
  }
  return null;
}

/**
 * Terminal history insert. Converges on the deterministic `_id`; a survived
 * insert error reports `guard-rejected` so the applied prefix compensates
 * (the order reopens) instead of silently dropping audit.
 */
function makeHistoryStep(db: Db, matchKey: string, plan: ShareMatchPlan): MoneyFlowStep {
  return {
    name: "history",
    apply: async () => {
      const outcome = await recordShareTrade(
        db,
        {
          corporationId: new ObjectId(plan.corpIdHex),
          kind: "limit_fill",
          turn: plan.turn,
          shares: plan.history.shares,
          pricePerShareAnchor: plan.history.priceAnchor,
          corpCurrencyCode: plan.history.corpCcy,
          from: toParty(plan.history.from),
          to: toParty(plan.history.to),
          createdAt: new Date(plan.nowIso),
        },
        { _id: keyedInsertId(matchKey, "turn-share-match-history") }
      );
      if (outcome === "applied" || outcome === "already-applied") return outcome;
      return "guard-rejected";
    },
  };
}

/** Step build shared by first attempt and crash recovery (from the stored plan). */
export function buildShareMatchSteps(
  db: Db,
  matchKey: string,
  plan: ShareMatchPlan
): MoneyFlowStep[] {
  const now = new Date(plan.nowIso);
  const corpId = new ObjectId(plan.corpIdHex);
  const steps: MoneyFlowStep[] = [makeOrderClaimStep(db, matchKey, plan)];
  if (plan.direction === "sell") {
    if (plan.sellerDebit) {
      steps.push(
        makeCapDebitStep(
          db,
          deriveMoneyFlowKey(matchKey, "seller-debit"),
          corpId,
          plan.sellerDebit,
          plan.shares,
          now
        )
      );
    }
  } else {
    if (!plan.buyerCredit) throw new Error("share-match:buy-needs-buyer-credit");
    steps.push(
      makeCapCreditStep(
        db,
        "buyer-credit",
        deriveMoneyFlowKey(matchKey, "buyer-credit"),
        corpId,
        plan.buyerCredit,
        plan.shares,
        now
      )
    );
    if (plan.holdingsCredit) {
      const fundId = new ObjectId(plan.holdingsCredit.fundIdHex);
      const priceAnchor = plan.holdingsCredit.priceAnchor;
      const holdingsSub = deriveMoneyFlowKey(matchKey, "buyer-holdings-credit");
      steps.push({
        name: "buyer-holdings-credit",
        apply: () =>
          applyHoldingsCreditKeyed(db, holdingsSub, fundId, corpId, plan.shares, priceAnchor, now),
        revert: () =>
          revertHoldingsCreditKeyed(
            db,
            deriveMoneyFlowKey(holdingsSub, "compensate", "buyer-holdings-credit"),
            fundId,
            corpId,
            plan.shares,
            priceAnchor,
            now
          ),
      });
    }
  }
  if (plan.cashLeg) {
    steps.push(
      makeCashStep(
        db,
        "match-cash",
        deriveMoneyFlowKey(matchKey, "match-cash"),
        plan.cashLeg,
        false,
        now
      )
    );
  }
  if (plan.dealerLeg) {
    steps.push(makeDealerStep(db, matchKey, plan));
  }
  steps.push(makeFloatStep(db, matchKey, plan));
  steps.push(makeHistoryStep(db, matchKey, plan));
  return steps;
}

/**
 * Execute one match to exactly one terminal state. First attempt persists
 * the immutable plan on the receipt, then runs the steps; a same-key retry
 * rebuilds the steps from the STORED plan and converges. Throws the mapped
 * `share-match:<step>:<outcome>` error for the failed step; the driver
 * skips that match and continues with the rest of the batch.
 */
export async function executeShareMatchFlow(
  db: Db,
  plan: ShareMatchPlan,
  fingerprint?: string
): Promise<ShareMatchOutcome> {
  const matchKey = plan.matchKey;
  const print = fingerprint ?? buildShareMatchFingerprint(plan);
  const claim = await claimMoneyFlowReceipt(receipts(db), matchKey, print);
  if (claim === "duplicate") {
    const settled = await receiptsEx(db).findOne({ _id: matchKey });
    const stored = settled?.shareMatchPlan as ShareMatchPlan | undefined;
    const outcome = stored?.outcome;
    if (outcome && typeof outcome.sharesMoved === "number") return { ...outcome };
    return { sharesMoved: plan.shares };
  }
  let active: ShareMatchPlan = plan;
  if (claim === "in-progress") {
    const existing = await receiptsEx(db).findOne({ _id: matchKey });
    const stored = existing?.shareMatchPlan;
    if (!isShareMatchPlan(stored)) {
      throw new Error("share-match:plan-never-stored");
    }
    active = stored;
  } else {
    // Persist the resume plan before any match write. Deliberately unsettled
    // on failure: a real crash here runs no further code, leaving the receipt
    // plan-less `in_progress`, so settling here would mask the crash with a
    // write the dead process could never have run. Key recovery owns the
    // settlement and fails the plan-less receipt without guessing.
    await receiptsEx(db).updateOne(
      { _id: matchKey },
      { $set: { shareMatchPlan: plan, updatedAt: new Date() } }
    );
  }
  await runMoneyFlowSteps(
    receipts(db),
    matchKey,
    buildShareMatchSteps(db, matchKey, active),
    mapMatchError
  );
  const outcome: ShareMatchOutcome = { sharesMoved: active.shares };
  await receiptsEx(db).updateOne(
    { _id: matchKey },
    { $set: { "shareMatchPlan.outcome": outcome, updatedAt: new Date() } }
  );
  return outcome;
}

export type ShareMatchRecoveryAction =
  | "match-recovered"
  | "match-incomplete"
  | "settled-failed-no-plan"
  | "skipped-settled"
  | "skipped-missing";

export interface ShareMatchRecoveryResult {
  matchKey: string;
  action: ShareMatchRecoveryAction;
}

/**
 * Crash recovery for one match, from only the match key: reloads the stored
 * plan and re-runs the keyed steps to convergence. Never invents amounts; a
 * missing plan settles `failed` (nothing is recoverable, ops owns it).
 */
export async function recoverShareMatchByKey(
  db: Db,
  matchKey: string
): Promise<ShareMatchRecoveryResult> {
  const receipt = await receiptsEx(db).findOne({ _id: matchKey });
  if (!receipt) return { matchKey, action: "skipped-missing" };
  if (receipt.status !== "in_progress") return { matchKey, action: "skipped-settled" };
  const stored = receipt.shareMatchPlan;
  if (!isShareMatchPlan(stored)) {
    await failMoneyFlowReceipt(receipts(db), matchKey, "share-match:plan-never-stored");
    return { matchKey, action: "settled-failed-no-plan" };
  }
  try {
    await runMoneyFlowSteps(
      receipts(db),
      matchKey,
      buildShareMatchSteps(db, matchKey, stored),
      mapMatchError
    );
  } catch {
    return { matchKey, action: "match-incomplete" };
  }
  await receiptsEx(db).updateOne(
    { _id: matchKey },
    {
      $set: {
        "shareMatchPlan.outcome": { sharesMoved: stored.shares },
        updatedAt: new Date(),
      },
    }
  );
  return { matchKey, action: "match-recovered" };
}

/**
 * Bounded match orphan scan for the turn driver. Recovers every
 * `in_progress` match receipt from its stored plan so interrupted matches
 * converge before the fresh scan computes new fills. Returns per-receipt
 * results; a receipt whose steps throw stays `in_progress` (TTL-visible)
 * for the next pass instead of being guessed at.
 *
 * Plan-less receipts (claim insert landed, plan store never did, so no
 * match write ran) settle `failed` here too: otherwise the fresh scan in
 * the same pass recomputes the same key, hits the plan-less receipt, and
 * strands it `in_progress` forever. Failing is truthful because the
 * prefix is provably empty, and the order reopens for a later turn.
 */
export async function recoverShareMatchOrphans(
  db: Db,
  limit = 50
): Promise<ShareMatchRecoveryResult[]> {
  const stuck = await receiptsEx(db)
    .find({ status: "in_progress", shareMatchPlan: { $exists: true } })
    .limit(limit)
    .toArray();
  const results: ShareMatchRecoveryResult[] = [];
  for (const receipt of stuck) {
    results.push(await recoverShareMatchByKey(db, receipt._id));
  }
  if (results.length >= limit) return results;
  const planless = await receiptsEx(db)
    .find({ status: "in_progress", shareMatchPlan: { $exists: false } })
    .limit(limit - results.length)
    .toArray();
  for (const receipt of planless) {
    if (typeof receipt._id !== "string" || !receipt._id.startsWith("turn-share-match:")) {
      continue;
    }
    results.push(await recoverShareMatchByKey(db, receipt._id));
  }
  return results;
}
