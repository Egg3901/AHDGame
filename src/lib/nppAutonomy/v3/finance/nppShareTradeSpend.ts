import { randomUUID } from "node:crypto";
import { ObjectId, type ClientSession, type Collection, type Db, type Filter } from "mongodb";
import {
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  deriveMoneyFlowKey,
  failMoneyFlowReceipt,
  makeLegStep,
  MoneyFlowTerminalError,
  runMoneyFlowSteps,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
  type MoneyFlowLeg,
  type MoneyFlowLegOutcome,
  type MoneyFlowOptions,
  type MoneyFlowReceipt,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import {
  makeCapCreditStep,
  makeCapDebitStep,
  makeCashStep,
  type ShareFillCapLeg,
  type ShareFillCashLeg,
} from "@/lib/corporations/commands/shareTrading/shareFillMoney";
import {
  makeDealerStep,
  type ShareOrderPlacementDealer,
} from "@/lib/corporations/shareOrderPlacement";
import { onFloatSellCommitted } from "@/lib/corporations/shareEscrowSettlement";

/**
 * Keyed NPP float trades (issue #1672).
 *
 * `nppBuyShares` / `nppSellShares` ran every trade debit-first with manual
 * compensation: a crash between the NPP cash debit and the cap-table credit
 * left the NPP down with no shares (the guarded float check then reported a
 * full float on retry, stranding cash), a crash between the issuer
 * settlement and the share debit left the issuer down with the seller
 * unpaid, and every issuer-settlement leg (`applyFloatBuyCredit` /
 * `settleFloatSellDebit`) ran outside any receipt, so a crash there stranded
 * money on exactly one side with no same-key retry able to converge it.
 *
 * This module runs every NPP float buy and sell as one keyed money flow,
 * following the share-fill money, order-placement, and public-share-trade
 * conventions, reusing their helpers (no parallel state machine):
 *
 * - One receipt per trade attempt. Keys are deterministic per action
 *   (`npp-share-buy:<turn>:<npp>:<corp>:<shares>` and the sell twin), so a
 *   same-turn retry addresses the same receipt; an explicit caller key
 *   overrides. Same-key retries converge on the stored plan and return the
 *   stored response; a key reused with a different fingerprint throws
 *   `MoneyFlowKeyConflictError` (fail closed); a key that settled without
 *   completing throws `MoneyFlowTerminalError`, mapped back to the stored
 *   failure reason so turn sweeps never crash on a re-run.
 * - The caller (`nppShares`) pins every amount, currency figure, dealer
 *   routing decision, escrow split, CEO-vacate snapshot, and guard error
 *   string BEFORE the flow starts, and the flow stores that immutable plan
 *   on the receipt before the first step. Recovery replays the stored
 *   figures instead of repricing from post-debit state, so FX drift between
 *   attempt and retry cannot move money.
 * - Step order mirrors the legacy write order. Buys: NPP cash debit, float
 *   decrement (guarded, the legacy `publicFloat >= shares` gate), NPP
 *   cap-table credit, issuer credit (pool / treasury / escrow via the shared
 *   placement dealer shapes). Sells: issuer debit first (the legacy buyback
 *   gate: pool depth, then gated treasury, then floored escrow split), NPP
 *   cap-table debit (the legacy sufficiency gate), float increment with the
 *   legacy CEO-vacate mutation folded in, proceeds credit.
 * - Cash legs gate `$gte` + `$ne: key` in one atomic write (exactly the
 *   legacy guarded-debit semantics), cap-table moves reuse the keyed cap
 *   debit/credit steps (now covering the `nppId` holder field), and
 *   `runMoneyFlowSteps` reverses the applied prefix with keyed inverses
 *   before settling, so a trade ends `completed` or terminal without
 *   effect, never partial.
 * - The float step carries the legacy order-flow `$inc` verbatim (no wash
 *   exclusion: the NPP path never had the wash guard, and this preserves
 *   that). The CEO-vacate mutation rides the sell float step with a pinned
 *   restore snapshot matching the legacy shape exactly (sets `ceoVacant` /
 *   `ceoVacantSinceTurn`, unsets only `ceoId`), so a compensated sell
 *   restores the exact prior tenure fields.
 * - There is no history, tx, audit, or notification write on this path
 *   (the legacy NPP path has none: no `shareTradeHistory`, no `emitTx`, no
 *   `recordAudit`, no takeover notify), so the post-commit rule holds
 *   vacuously. The only post-commit effect is the legacy fire-and-forget
 *   `onFloatSellCommitted` issuance-proceeds writeback, kept best effort:
 *   it never fails the committed sell.
 * - Under real transactions the legs join the caller's session (forwarded
 *   through `MoneyFlowOptions`), preserving the old atomicity there.
 *
 * Legacy economics are preserved: identical debit/credit math and rounding,
 * identical guard order and error strings (pinned per guard at plan time),
 * identical dealer routing (pool counterparty when the quote is pool-backed,
 * else the issuer escrow or treasury leg), home-currency-only scope, and the
 * market-depth gate on sells.
 */

export const NPP_SHARE_TRADE_FINGERPRINT_DOMAIN = "npp-share-trade";
export const NPP_SHARE_TRADE_BUY_KEY_PREFIX = "npp-share-buy";
export const NPP_SHARE_TRADE_SELL_KEY_PREFIX = "npp-share-sell";

export type NppShareTradeKind = "npp-buy" | "npp-sell";

export type NppShareTradeStepName =
  "npp-debit" | "float" | "npp-credit" | "dealer" | "seller-debit" | "proceeds-credit";

export interface NppShareTradePinnedError {
  message: string;
  status: number;
}

/** Prior CEO fields pinned at plan time so a compensated sell restores them. */
export interface NppShareTradeCeoSnapshot {
  ceoIdHex: string;
  ceoVacant: boolean;
  ceoVacantSinceTurn?: number;
}

/**
 * Immutable resume plan pinned before the first step. Every remainder,
 * amount, currency figure, routing decision, snapshot, guard error string,
 * and response body is fixed here; recovery replays these figures.
 */
export interface NppShareTradePlan {
  version: 1;
  tradeKey: string;
  kind: NppShareTradeKind;
  nppIdHex: string;
  corpIdHex: string;
  shares: number;
  executionPrice: number;
  turn: number;
  nowIso: string;
  orderFlowEligible: boolean;
  /** NPP investment-cash leg (debit on buys, proceeds credit on sells). */
  cashLeg: ShareFillCashLeg;
  /** NPP cap-table leg (credit on buys, debit on sells). */
  capLeg: ShareFillCapLeg;
  /** Issuer settlement (buy credit / sell debit). */
  dealer: ShareOrderPlacementDealer | null;
  /** Raw local-currency issuer movement for the post-commit writeback. */
  issuerAmountLocal: number;
  /** Sell CEO vacate folded into the float step. Null unless the sale vacates. */
  ceoVacate: NppShareTradeCeoSnapshot | null;
  /** Legacy guard error strings pinned per step name. */
  errors: Record<NppShareTradeStepName, NppShareTradePinnedError>;
  /**
   * Exact legacy response body. `investmentCashAnchor` is filled live
   * post-commit (it is only observable after the debit lands) and stored
   * for replays; every other field is pinned before the flow starts.
   */
  response: Record<string, unknown>;
}

export function isNppShareTradePlan(value: unknown): value is NppShareTradePlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.version === 1 &&
    typeof plan.tradeKey === "string" &&
    (plan.kind === "npp-buy" || plan.kind === "npp-sell") &&
    typeof plan.nppIdHex === "string" &&
    typeof plan.corpIdHex === "string" &&
    typeof plan.response === "object"
  );
}

export function buildNppShareBuyKey(
  turn: number,
  nppId: ObjectId,
  corpId: ObjectId,
  shares: number
): string {
  return `${NPP_SHARE_TRADE_BUY_KEY_PREFIX}:${turn}:${nppId.toHexString()}:${corpId.toHexString()}:${shares}`;
}

export function buildNppShareSellKey(
  turn: number,
  nppId: ObjectId,
  corpId: ObjectId,
  shares: number
): string {
  return `${NPP_SHARE_TRADE_SELL_KEY_PREFIX}:${turn}:${nppId.toHexString()}:${corpId.toHexString()}:${shares}`;
}

export function buildNppShareTradeFingerprint(plan: NppShareTradePlan): string {
  const cents = (n: number): string => String(Math.round(n * 100) / 100);
  const dealer = plan.dealer
    ? `${plan.dealer.kind}:${cents(plan.dealer.amountLocal)}:${plan.dealer.currency ?? "none"}:${plan.dealer.flowKind ?? "none"}:${cents(plan.dealer.escrowPart ?? 0)}:${cents(plan.dealer.treasuryPart ?? 0)}`
    : "none";
  return [
    NPP_SHARE_TRADE_FINGERPRINT_DOMAIN,
    plan.kind,
    plan.nppIdHex,
    plan.corpIdHex,
    `shares:${plan.shares}`,
    `exec:${cents(plan.executionPrice)}`,
    `cash:${plan.cashLeg.collection}:${plan.cashLeg.idHex}:${plan.cashLeg.field}:${cents(plan.cashLeg.amount)}`,
    `cap:${plan.capLeg.field}:${plan.capLeg.idHex}:${cents(plan.capLeg.pricePerShare)}`,
    `dealer:${dealer}`,
    `vacate:${plan.ceoVacate ? plan.ceoVacate.ceoIdHex : "none"}`,
    `turn:${plan.turn}`,
  ].join(":");
}

export type NppShareTradeResult =
  | { ok: true; body: Record<string, unknown>; replayed: boolean }
  | { ok: false; error: string; status: number };

type NppShareTradeReceipt = MoneyFlowReceipt & {
  nppShareTradePlan?: unknown;
  nppShareTradeResponse?: unknown;
};

function receipts(db: Db): Collection<MoneyFlowReceipt> {
  return db.collection<MoneyFlowReceipt>(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION);
}

function receiptsEx(db: Db): Collection<NppShareTradeReceipt> {
  return db.collection<NppShareTradeReceipt>(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION);
}

function sessionOpts(session?: ClientSession): MoneyFlowOptions {
  return session ? { session } : {};
}

function mapTradeError(plan: NppShareTradePlan) {
  return (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error => {
    const pinned = plan.errors[step.name as NppShareTradeStepName];
    if (pinned) {
      return new Error(`NPP_SHARE_TRADE:${pinned.status}:${pinned.message}`);
    }
    return new Error(`npp-share-trade:${step.name}:${outcome}`);
  };
}

function tradeErrorOf(error: Error): { error: string; status: number } {
  const match = /^NPP_SHARE_TRADE:(\d+):([\s\S]*)$/.exec(error.message);
  if (match) return { error: match[2]!, status: Number(match[1]) };
  throw error;
}

interface TradeCorpAccount {
  _id: ObjectId;
  appliedMoneyFlowKeys?: string[];
}

/**
 * Float `$inc` carrying the legacy order-flow record verbatim. Buys
 * decrement under the legacy `$gte` gate; sells increment unconditionally.
 * Revert is the exact inverse through the keyed leg machinery.
 */
function makeTradeFloatStep(
  db: Db,
  tradeKey: string,
  corpId: ObjectId,
  delta: number,
  orderFlow: Record<string, number>,
  now: Date
): MoneyFlowStep {
  const extraIncs: Record<string, number> | undefined =
    Object.keys(orderFlow).length > 0 ? orderFlow : undefined;
  const leg: MoneyFlowLeg<TradeCorpAccount> = {
    name: "float",
    collection: db.collection<TradeCorpAccount>("corporations"),
    docId: corpId,
    field: "publicFloat",
    delta,
    ...(delta < 0 ? { minBalance: -delta } : {}),
    ...(extraIncs ? { extraIncs } : {}),
    set: { updatedAt: now },
  };
  const step = makeLegStep(deriveMoneyFlowKey(tradeKey, "float"), leg);
  return {
    name: step.name,
    apply: (applyOptions) => step.apply!(applyOptions ?? {}),
    revert: step.revert ? (revertOptions) => step.revert!(revertOptions ?? {}) : undefined,
  };
}

/**
 * Sell float increment with the legacy CEO-vacate mutation folded in (the
 * legacy sell performs the share debit, float increment, and CEO vacate in
 * one update: `$set` of `ceoVacant`/`ceoVacantSinceTurn`, `$unset` of only
 * `ceoId`). The vacate snapshot is pinned in the plan; the revert restores
 * the exact prior CEO fields so a compensated sell leaves tenure untouched.
 */
function makeFloatCeoStep(
  db: Db,
  tradeKey: string,
  corpId: ObjectId,
  delta: number,
  orderFlow: Record<string, number>,
  vacate: NppShareTradeCeoSnapshot,
  vacateTurn: number,
  now: Date
): MoneyFlowStep {
  const subkey = deriveMoneyFlowKey(tradeKey, "float");
  const corps = db.collection<TradeCorpAccount>("corporations");
  const extraIncs: Record<string, number> | undefined =
    Object.keys(orderFlow).length > 0 ? orderFlow : undefined;
  const negatedExtra: Record<string, number> | undefined = extraIncs
    ? Object.fromEntries(Object.entries(extraIncs).map(([field, amount]) => [field, -amount]))
    : undefined;
  const restoreSet: Record<string, unknown> = {
    ceoId: new ObjectId(vacate.ceoIdHex),
    ceoVacant: vacate.ceoVacant,
    updatedAt: now,
  };
  if (vacate.ceoVacantSinceTurn !== undefined) {
    restoreSet.ceoVacantSinceTurn = vacate.ceoVacantSinceTurn;
  }
  const restoreUnset: Record<string, ""> = {};
  if (vacate.ceoVacantSinceTurn === undefined) restoreUnset.ceoVacantSinceTurn = "";
  return {
    name: "float",
    apply: (applyOptions) =>
      applyKeyedUpdate(
        subkey,
        {
          collection: corps,
          filter: { _id: corpId } as Filter<TradeCorpAccount>,
          update: {
            $inc: { publicFloat: delta, ...(extraIncs ?? {}) },
            $set: { updatedAt: now, ceoVacant: true, ceoVacantSinceTurn: vacateTurn },
            $unset: { ceoId: "" },
          },
        },
        applyOptions ?? {}
      ),
    revert: (revertOptions) =>
      applyKeyedUpdate(
        deriveMoneyFlowKey(subkey, "compensate", "float"),
        {
          collection: corps,
          filter: { _id: corpId } as Filter<TradeCorpAccount>,
          update: {
            $inc: { publicFloat: -delta, ...(negatedExtra ?? {}) },
            $set: restoreSet,
            ...(Object.keys(restoreUnset).length > 0 ? { $unset: restoreUnset } : {}),
          },
        },
        revertOptions ?? {}
      ),
  };
}

function buildBuyOrderFlow(orderFlowEligible: boolean, notional: number): Record<string, number> {
  if (!orderFlowEligible || !(notional > 0)) return {};
  return { orderFlowWindowBuyValue: notional };
}

function buildSellOrderFlow(orderFlowEligible: boolean, notional: number): Record<string, number> {
  if (!orderFlowEligible || !(notional > 0)) return {};
  return { orderFlowWindowSellValue: notional };
}

/** Step build shared by first attempt and crash recovery (from the stored plan). */
export function buildNppShareTradeSteps(db: Db, plan: NppShareTradePlan): MoneyFlowStep[] {
  const now = new Date(plan.nowIso);
  const corpId = new ObjectId(plan.corpIdHex);
  const notional = plan.shares * plan.executionPrice;
  const steps: MoneyFlowStep[] = [];
  if (plan.kind === "npp-buy") {
    steps.push(
      makeCashStep(
        db,
        "npp-debit",
        deriveMoneyFlowKey(plan.tradeKey, "npp-debit"),
        plan.cashLeg,
        true,
        now
      )
    );
    // Legacy buy order: the guarded float decrement runs before any share
    // row is touched, so a drained float fails before the cap table moves;
    // compensation reverses both on a later failure.
    steps.push(
      makeTradeFloatStep(
        db,
        plan.tradeKey,
        corpId,
        -plan.shares,
        buildBuyOrderFlow(plan.orderFlowEligible, notional),
        now
      )
    );
    steps.push(
      makeCapCreditStep(
        db,
        "npp-credit",
        deriveMoneyFlowKey(plan.tradeKey, "npp-credit"),
        corpId,
        plan.capLeg,
        plan.shares,
        now
      )
    );
    if (plan.dealer) {
      const dealerStep = makeDealerStep(db, plan.tradeKey, corpId, plan.dealer, now);
      if (dealerStep) steps.push(dealerStep);
    }
  } else {
    // Legacy sell order: the issuer buyback settles FIRST as the gate, then
    // the share debit, then the proceeds credit.
    if (plan.dealer) {
      const dealerStep = makeDealerStep(db, plan.tradeKey, corpId, plan.dealer, now);
      if (dealerStep) steps.push(dealerStep);
    }
    steps.push(
      makeCapDebitStep(
        db,
        deriveMoneyFlowKey(plan.tradeKey, "seller-debit"),
        corpId,
        plan.capLeg,
        plan.shares,
        now
      )
    );
    const sellFlow = buildSellOrderFlow(plan.orderFlowEligible, notional);
    if (plan.ceoVacate) {
      steps.push(
        makeFloatCeoStep(
          db,
          plan.tradeKey,
          corpId,
          plan.shares,
          sellFlow,
          plan.ceoVacate,
          plan.turn,
          now
        )
      );
    } else {
      steps.push(makeTradeFloatStep(db, plan.tradeKey, corpId, plan.shares, sellFlow, now));
    }
    steps.push(
      makeCashStep(
        db,
        "proceeds-credit",
        deriveMoneyFlowKey(plan.tradeKey, "proceeds-credit"),
        plan.cashLeg,
        false,
        now
      )
    );
  }
  return steps;
}

/** Live post-commit read of the NPP investment-cash balance (informational). */
async function readNppCashAfter(db: Db, plan: NppShareTradePlan): Promise<number> {
  try {
    const doc = (await db.collection<{ _id: ObjectId }>("npps").findOne({
      _id: new ObjectId(plan.nppIdHex),
    } as Filter<{ _id: ObjectId }>)) as unknown as Record<string, unknown> | null;
    const value = doc?.nppInvestmentCashAnchor;
    return typeof value === "number" ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * Stored response if present, else the stored plan body with the balance
 * filled live. The second case only happens when the response-store write
 * itself crashed (the receipt already settled `completed`): the money
 * outcome is pinned in the plan, only the informational balance is re-read.
 */
async function storedBodyOrLive(
  db: Db,
  receipt: NppShareTradeReceipt
): Promise<Record<string, unknown> | null> {
  if (receipt.nppShareTradeResponse && typeof receipt.nppShareTradeResponse === "object") {
    return receipt.nppShareTradeResponse as Record<string, unknown>;
  }
  const stored = receipt.nppShareTradePlan;
  if (isNppShareTradePlan(stored)) {
    return { ...stored.response, investmentCashAnchor: await readNppCashAfter(db, stored) };
  }
  return null;
}

/**
 * Lightweight same-key conflict check for the caller fast path: the full
 * fingerprint needs live reads the fast path deliberately skips, but a key
 * reused for a different direction, party, corp, or size fails closed here
 * instead of returning the wrong stored outcome.
 */
export function isNppShareTradeKeyReuse(
  stored: unknown,
  expected: { kind: NppShareTradeKind; nppIdHex: string; corpIdHex: string; shares: number }
): boolean {
  if (!isNppShareTradePlan(stored)) return false;
  return (
    stored.kind !== expected.kind ||
    stored.nppIdHex !== expected.nppIdHex ||
    stored.corpIdHex !== expected.corpIdHex ||
    stored.shares !== expected.shares
  );
}

/** Post-commit best-effort side effect shared by fresh settle and recovery. */
async function runTradePostCommit(db: Db, plan: NppShareTradePlan): Promise<void> {
  if (plan.kind === "npp-sell") {
    try {
      await onFloatSellCommitted(
        db,
        { _id: new ObjectId(plan.corpIdHex) } as { _id: ObjectId },
        plan.issuerAmountLocal
      );
    } catch {
      // Best effort; never fail the committed sell.
    }
  }
}

/**
 * Execute one NPP float trade to exactly one terminal state. The plan is
 * already fully pinned by the caller (`nppShares`); this claims the receipt,
 * stores the plan, runs the steps, fills the live balance into the stored
 * response, and returns the legacy body. Throws
 * MoneyFlowKeyConflictError from the claim when the key is reused for a
 * different transfer; terminal receipts map back to their stored failure
 * instead of throwing, so turn sweeps never crash on a re-run.
 */
export async function executeNppShareTradeFlow(
  db: Db,
  plan: NppShareTradePlan,
  opts: { idempotencyKey?: string; session?: ClientSession } = {}
): Promise<NppShareTradeResult> {
  const tradeKey = opts.idempotencyKey ?? plan.tradeKey;
  if (tradeKey !== plan.tradeKey) {
    throw new Error("npp-share-trade:key-mismatch");
  }
  const options = sessionOpts(opts.session);
  const fingerprint = buildNppShareTradeFingerprint(plan);
  let claim: string;
  try {
    claim = await claimMoneyFlowReceipt(receipts(db), tradeKey, fingerprint, options);
  } catch (error) {
    if (error instanceof MoneyFlowTerminalError) {
      return terminalResultOf(db, tradeKey, plan);
    }
    throw error;
  }
  if (claim === "duplicate") {
    const stored = await receiptsEx(db).findOne({ _id: tradeKey });
    if (stored) {
      const body = await storedBodyOrLive(db, stored);
      if (body) return { ok: true, body, replayed: true };
    }
    return { ok: true, body: plan.response, replayed: true };
  }
  if (claim === "in-progress") {
    return recoverNppShareTradeByKey(db, tradeKey, options);
  }

  try {
    await receiptsEx(db).updateOne(
      { _id: tradeKey },
      { $set: { nppShareTradePlan: { ...plan }, updatedAt: new Date() } }
    );
  } catch (planError) {
    await failMoneyFlowReceipt(receipts(db), tradeKey, "npp-share-trade:plan-store", options);
    throw planError;
  }

  try {
    await runMoneyFlowSteps(
      receipts(db),
      tradeKey,
      buildNppShareTradeSteps(db, plan),
      mapTradeError(plan),
      options
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("NPP_SHARE_TRADE:")) {
      const mapped = tradeErrorOf(error);
      return { ok: false, error: mapped.error, status: mapped.status };
    }
    throw error;
  }
  await runTradePostCommit(db, plan);
  const investmentCashAnchor = await readNppCashAfter(db, plan);
  const body = { ...plan.response, investmentCashAnchor };
  await receiptsEx(db).updateOne(
    { _id: tradeKey },
    { $set: { nppShareTradeResponse: { ...body }, updatedAt: new Date() } }
  );
  return { ok: true, body, replayed: false };
}

async function terminalResultOf(
  db: Db,
  tradeKey: string,
  plan: NppShareTradePlan
): Promise<NppShareTradeResult> {
  const receipt = await receiptsEx(db).findOne({ _id: tradeKey });
  const message =
    typeof receipt?.error === "string" && receipt.error.startsWith("NPP_SHARE_TRADE:")
      ? tradeErrorOf(new Error(receipt.error)).error
      : "Trade already settled; retry with a new key.";
  return { ok: false, error: message, status: 409 };
}

/**
 * Caller-facing key lookup: when the deterministic key already has a
 * receipt on file, the first attempt already validated, so the retry
 * reconciles through the keyed steps instead of re-running the guards
 * (which post-debit reads would fail). Returns null when no receipt exists
 * and the caller must validate fresh.
 */
export async function getStoredNppShareTradeResponse(
  db: Db,
  tradeKey: string
): Promise<{ settled: boolean } | null> {
  const receipt = await receiptsEx(db).findOne({ _id: tradeKey });
  if (!receipt) return null;
  return { settled: receipt.status !== "in_progress" };
}

/** Stored plan on a receipt, for the caller fast-path key-reuse check. */
export async function getNppShareTradeStoredPlan(
  db: Db,
  tradeKey: string
): Promise<unknown | null> {
  const receipt = await receiptsEx(db).findOne({ _id: tradeKey });
  if (!receipt) return null;
  return receipt.nppShareTradePlan ?? null;
}

async function runStoredTradePlan(
  db: Db,
  tradeKey: string,
  plan: NppShareTradePlan,
  options: MoneyFlowOptions = {}
): Promise<NppShareTradeResult> {
  try {
    await runMoneyFlowSteps(
      receipts(db),
      tradeKey,
      buildNppShareTradeSteps(db, plan),
      mapTradeError(plan),
      options
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("NPP_SHARE_TRADE:")) {
      const mapped = tradeErrorOf(error);
      return { ok: false, error: mapped.error, status: mapped.status };
    }
    return { ok: false, error: "Failed to record trade", status: 500 };
  }
  await runTradePostCommit(db, plan);
  const investmentCashAnchor = await readNppCashAfter(db, plan);
  const body = isNppShareTradePlan(plan)
    ? { ...(plan.response as Record<string, unknown>), investmentCashAnchor }
    : { ...plan.response };
  await receiptsEx(db).updateOne(
    { _id: tradeKey },
    { $set: { nppShareTradeResponse: { ...body }, updatedAt: new Date() } }
  );
  return { ok: true, body, replayed: true };
}

/**
 * Crash recovery for one trade receipt, from only the flow key: replays the
 * stored plan to convergence. A plan-less receipt settled here as `failed`
 * is truthful because the plan store precedes the first step, so a missing
 * plan means no step ever ran and nothing moved.
 */
export async function recoverNppShareTradeReceipt(
  db: Db,
  tradeKey: string,
  options: MoneyFlowOptions = {}
): Promise<NppShareTradeRecoveryResult> {
  const receipt = await receiptsEx(db).findOne({ _id: tradeKey });
  if (!receipt) return { tradeKey, action: "skipped-missing" };
  if (receipt.status !== "in_progress") return { tradeKey, action: "skipped-settled" };
  const stored = receipt.nppShareTradePlan;
  if (!isNppShareTradePlan(stored)) {
    await failMoneyFlowReceipt(
      receipts(db),
      tradeKey,
      "npp-share-trade:plan-never-stored",
      options
    );
    return { tradeKey, action: "settled-failed-no-plan" };
  }
  const result = await runStoredTradePlan(db, tradeKey, stored, options);
  return {
    tradeKey,
    action: result.ok ? "trade-recovered" : "trade-incomplete",
  };
}

/**
 * Caller-facing recovery: maps the receipt action onto the legacy
 * trade surface. Same-key retries converge here instead of double-trading.
 */
export async function recoverNppShareTradeByKey(
  db: Db,
  tradeKey: string,
  options: MoneyFlowOptions = {}
): Promise<NppShareTradeResult> {
  const receipt = await receiptsEx(db).findOne({ _id: tradeKey });
  if (!receipt)
    return { ok: false, error: "Trade did not complete; retry with a new key", status: 500 };
  if (receipt.status === "completed") {
    const body = await storedBodyOrLive(db, receipt);
    if (body) return { ok: true, body, replayed: true };
    return { ok: false, error: "Trade did not complete; retry with a new key", status: 500 };
  }
  if (receipt.status !== "in_progress") {
    return terminalResultOf(db, tradeKey, {
      tradeKey,
      response: {},
    } as NppShareTradePlan);
  }
  const result = await recoverNppShareTradeReceipt(db, tradeKey, options);
  switch (result.action) {
    case "trade-recovered":
    case "skipped-settled": {
      const settled = await receiptsEx(db).findOne({ _id: tradeKey });
      if (settled) {
        const body = await storedBodyOrLive(db, settled);
        if (body) return { ok: true, body, replayed: true };
      }
      return { ok: false, error: "Failed to record trade", status: 500 };
    }
    case "settled-failed-no-plan":
      return { ok: false, error: "Trade did not complete; retry with a new key", status: 500 };
    case "skipped-missing":
      return { ok: false, error: "Trade did not complete; retry with a new key", status: 500 };
    case "trade-incomplete": {
      const current = await receiptsEx(db).findOne({ _id: tradeKey });
      return { ok: false, error: current?.error ?? "Failed to record trade", status: 500 };
    }
  }
}

export type NppShareTradeRecoveryAction =
  | "trade-recovered"
  | "trade-incomplete"
  | "settled-failed-no-plan"
  | "skipped-settled"
  | "skipped-missing";

export interface NppShareTradeRecoveryResult {
  tradeKey: string;
  action: NppShareTradeRecoveryAction;
}

/**
 * Bounded trade orphan scan. Recovers every `in_progress` NPP trade receipt
 * from its stored plan; plan-less receipts settle `failed` (the plan store
 * precedes the first step, so nothing moved). Foreign-domain receipts stay
 * out via the plan field plus the fingerprint prefix. There is no
 * turn-driver wiring (like the index-fund float buys/sells): no intent row
 * exists to strand, so an unretried partial stays as the crash left it and
 * the next turn's trades run under new keys; same-turn retries converge by
 * key, and ops can re-drive this scan.
 */
export async function recoverNppShareTradeOrphans(
  db: Db,
  limit = 50
): Promise<NppShareTradeRecoveryResult[]> {
  const stuck = await receiptsEx(db)
    .find({ status: "in_progress", nppShareTradePlan: { $exists: true } })
    .limit(limit)
    .toArray();
  const results: NppShareTradeRecoveryResult[] = [];
  for (const receipt of stuck) {
    const stored = receipt.nppShareTradePlan;
    if (!isNppShareTradePlan(stored)) {
      await failMoneyFlowReceipt(receipts(db), receipt._id, "npp-share-trade:plan-never-stored");
      results.push({ tradeKey: receipt._id, action: "settled-failed-no-plan" });
      continue;
    }
    const result = await runStoredTradePlan(db, receipt._id, stored);
    results.push({
      tradeKey: receipt._id,
      action: result.ok ? "trade-recovered" : "trade-incomplete",
    });
  }
  if (results.length >= limit) return results;
  const planless = await receiptsEx(db)
    .find({ status: "in_progress", nppShareTradePlan: { $exists: false } })
    .limit(limit - results.length)
    .toArray();
  for (const receipt of planless) {
    if (typeof receipt._id !== "string") continue;
    if (
      typeof receipt.fingerprint !== "string" ||
      !receipt.fingerprint.startsWith(NPP_SHARE_TRADE_FINGERPRINT_DOMAIN)
    ) {
      continue;
    }
    await failMoneyFlowReceipt(receipts(db), receipt._id, "npp-share-trade:plan-never-stored");
    results.push({ tradeKey: receipt._id, action: "settled-failed-no-plan" });
  }
  return results;
}

/** Fresh-attempt key when the caller passes neither a turn nor an explicit key. */
export function mintNppShareTradeKey(): string {
  return randomUUID();
}
