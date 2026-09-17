import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { ClientSession, Collection, Db } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  claimMoneyFlowReceipt,
  deriveMoneyFlowKey,
  failMoneyFlowReceipt,
  keyedInsertId,
  makeInsertStep,
  makeLegStep,
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
  runMoneyFlowSteps,
  type MoneyFlowAccount,
  type MoneyFlowLegOutcome,
  type MoneyFlowReceipt,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { buildPersonalBalanceInc } from "@/lib/currency/characterFunds";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { IndexFundTransaction } from "@/lib/db/types";

/** Fund cash credit failed (the fund row went between plan and apply): nothing applied, caller skips the accrual. */
export const FUND_DIVIDEND_FUND = "FUND_DIVIDEND_FUND";
/** Holder credit failed (the holder row went between plan and apply): applied prefix compensated, caller skips the accrual. */
export const FUND_DIVIDEND_HOLDER = "FUND_DIVIDEND_HOLDER";
/** Dividend audit-row insert failed after money moved: prefix compensated, caller retries next turn. */
export const FUND_DIVIDEND_TX = "FUND_DIVIDEND_TX";

/** Domain for the deterministic pass-through audit-row `_id` derived from the flow key. */
const PASS_THROUGH_TX_DOMAIN = "indexfund-dividend-passthrough-tx";
/** Domain for the deterministic reinvest audit-row `_id` derived from the flow key. */
const REINVEST_TX_DOMAIN = "indexfund-dividend-reinvest-tx";

/** Holder targets one dividend distribution can credit. */
export type FundDividendHolderKind = "character" | "imperial_character" | "npp";

/** One pinned holder payout: resolved once by the caller, never recomputed on replay. */
export interface FundDividendRecipient {
  holderKind: FundDividendHolderKind;
  holderId: ObjectId;
  /** Display name at plan time, for the holder audit entries. */
  holderName: string;
  /** Units held at plan time. */
  units: number;
  /** Floored 2dp anchor credit (what the wallet math debits the fund for). */
  amountAnchor: number;
  /** Native-currency wallet credit (anchor x pinned FX rate; equals anchor for NPP). */
  amountNative: number;
}

export interface FundDividendSpendInput {
  fundId: ObjectId;
  /** Fund display name at plan time, for audit rows. */
  fundName: string;
  fundSlug: string;
  fundTicker: string;
  anchorCurrencyCode: string;
  quotedNav: number;
  corporationId: ObjectId;
  corporationName?: string;
  /** Fund shares in the payer, for audit rows. */
  sharesHeld: number;
  /** Total dividend received, in anchor. */
  grossAnchor: number;
  /** 75% split, in anchor. */
  reinvestAnchor: number;
  /** Fund cash credit: reinvest + floored-but-unpaid remainder. Always > 0 when the flow runs. */
  retainedAnchor: number;
  /** Sum of pinned recipient anchor credits. */
  distributedAnchor: number;
  /** Recipient count, for audit rows. */
  holdersPaid: number;
  /** Pinned recipients in position order. */
  recipients: FundDividendRecipient[];
  /** Pinned AUD→fund-currency rate (1 with forex off or on a missing rate). */
  fundFxRate: number;
  forexEnabled: boolean;
  /** Cron turn, for keying and audit rows. */
  turn: number;
  /**
   * Caller-chosen fingerprint of the intended distribution (see
   * `buildFundDividendFingerprint`). A retry with the same key and
   * fingerprint reconciles the stored plan; a different fingerprint is a
   * different distribution and stays a `MoneyFlowKeyConflictError`.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key. The dividend pass derives one per fund,
   * corp, turn, gross, shares, and same-tuple occurrence (see
   * `buildFundDividendKey`) so a same-turn retry resumes instead of
   * double-paying. Omit to mint one: the attempt is still crash-safe within
   * itself, but a client retry mints a new key and is treated as a new
   * distribution (still guarded by the keyed steps).
   */
  idempotencyKey?: string;
}

/**
 * Deterministic idempotency key for one fund dividend distribution: one
 * (fund, corp) pair accrues at most a handful of payments per turn, so fund +
 * corp + turn + gross + shares names the attempt, with the same-tuple
 * occurrence index disambiguating repeated identical accruals (one per
 * same-fund cap-table row). A same-key retry (crash recovery, same-turn
 * double-fire) reuses it and reconciles; next turn's dividend gets a new key.
 */
export function buildFundDividendKey(
  fundId: ObjectId,
  corporationId: ObjectId,
  turn: number,
  grossAnchor: number,
  sharesHeld: number,
  occurrence = 0
): string {
  const cents = Math.round(grossAnchor * 100) / 100;
  return (
    `fund-dividend:${fundId.toHexString()}:${corporationId.toHexString()}` +
    `:turn:${turn}:gross:${cents}:shares:${sharesHeld}:n:${occurrence}`
  );
}

/**
 * Deterministic fingerprint for one dividend distribution attempt. Covers the
 * operation identity (fund, corp, turn, shares) plus every pinned amount, the
 * FX rate and currency, and every recipient (kind, id, units, anchor, native
 * figures), so a key reused for a different distribution fails closed instead
 * of replaying the wrong outcome. Audit-only text (corp name, fund name) is
 * not covered: a rename is the same money.
 */
export function buildFundDividendFingerprint(input: {
  fundId: ObjectId;
  corporationId: ObjectId;
  sharesHeld: number;
  grossAnchor: number;
  reinvestAnchor: number;
  retainedAnchor: number;
  distributedAnchor: number;
  holdersPaid: number;
  anchorCurrencyCode: string;
  quotedNav: number;
  fundFxRate: number;
  forexEnabled: boolean;
  recipients: FundDividendRecipient[];
  turn: number;
}): string {
  const cents = (n: number): string => String(Math.round(n * 100) / 100);
  const recipientPart = input.recipients
    .map(
      (r) =>
        `${r.holderKind}:${r.holderId.toHexString()}:units:${r.units}` +
        `:anchor:${cents(r.amountAnchor)}:native:${cents(r.amountNative)}`
    )
    .join("|");
  return [
    "fund-dividend",
    input.fundId.toHexString(),
    input.corporationId.toHexString(),
    `shares:${input.sharesHeld}`,
    `gross:${cents(input.grossAnchor)}`,
    `reinvest:${cents(input.reinvestAnchor)}`,
    `retained:${cents(input.retainedAnchor)}`,
    `distributed:${cents(input.distributedAnchor)}`,
    `holders:${input.holdersPaid}`,
    `ccy:${input.anchorCurrencyCode}`,
    `nav:${cents(input.quotedNav)}`,
    `fx:${cents(input.fundFxRate)}`,
    `forex:${input.forexEnabled ? "on" : "off"}`,
    `recipients:${recipientPart}`,
    `turn:${input.turn}`,
  ].join(":");
}

/** Stored distribution numbers, written post-commit so a replay reports stably. */
export interface FundDividendOutcome {
  grossAnchor: number;
  retainedAnchor: number;
  distributedAnchor: number;
  holdersPaid: number;
}

export function isFundDividendOutcome(value: unknown): value is FundDividendOutcome {
  if (!value || typeof value !== "object") return false;
  const outcome = value as Record<string, unknown>;
  return (
    typeof outcome.grossAnchor === "number" &&
    typeof outcome.retainedAnchor === "number" &&
    typeof outcome.distributedAnchor === "number" &&
    typeof outcome.holdersPaid === "number"
  );
}

/**
 * Crash-resume plan persisted on the flow receipt right after the fresh
 * claim, before any money moves. A same-key retry after a crash rebuilds its
 * steps from THIS plan, never from the caller's live input: the pass derives
 * every payout from live positions and ownership weights, so post-crash input
 * is computed from post-debit reads (and possibly changed ownership) and
 * running it would double-pay some holders while stiffing others. Resuming
 * the stored plan keeps the fund credit, every holder credit, and both audit
 * rows at exactly the attempted amounts and recipients.
 */
export interface FundDividendStoredPlan {
  version: 1;
  fundIdHex: string;
  fundName: string;
  fundSlug: string;
  fundTicker: string;
  anchorCurrencyCode: string;
  quotedNav: number;
  corporationIdHex: string;
  corporationName?: string;
  sharesHeld: number;
  grossAnchor: number;
  reinvestAnchor: number;
  retainedAnchor: number;
  distributedAnchor: number;
  holdersPaid: number;
  recipients: {
    holderKind: FundDividendHolderKind;
    holderIdHex: string;
    holderName: string;
    units: number;
    amountAnchor: number;
    amountNative: number;
  }[];
  fundFxRate: number;
  forexEnabled: boolean;
  turn: number;
  nowIso: string;
  outcome?: FundDividendOutcome;
}

function toStoredPlan(input: FundDividendSpendInput, now: Date): FundDividendStoredPlan {
  return {
    version: 1,
    fundIdHex: input.fundId.toHexString(),
    fundName: input.fundName,
    fundSlug: input.fundSlug,
    fundTicker: input.fundTicker,
    anchorCurrencyCode: input.anchorCurrencyCode,
    quotedNav: input.quotedNav,
    corporationIdHex: input.corporationId.toHexString(),
    ...(input.corporationName !== undefined ? { corporationName: input.corporationName } : {}),
    sharesHeld: input.sharesHeld,
    grossAnchor: input.grossAnchor,
    reinvestAnchor: input.reinvestAnchor,
    retainedAnchor: input.retainedAnchor,
    distributedAnchor: input.distributedAnchor,
    holdersPaid: input.holdersPaid,
    recipients: input.recipients.map((r) => ({
      holderKind: r.holderKind,
      holderIdHex: r.holderId.toHexString(),
      holderName: r.holderName,
      units: r.units,
      amountAnchor: r.amountAnchor,
      amountNative: r.amountNative,
    })),
    fundFxRate: input.fundFxRate,
    forexEnabled: input.forexEnabled,
    turn: input.turn,
    nowIso: now.toISOString(),
  };
}

function isStoredPlan(value: unknown): value is FundDividendStoredPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.version === 1 &&
    typeof plan.fundIdHex === "string" &&
    typeof plan.corporationIdHex === "string" &&
    typeof plan.anchorCurrencyCode === "string" &&
    Array.isArray(plan.recipients)
  );
}

/** Receipt rows carry the resume plan under this field (never in the shared type). */
type FundDividendReceipt = MoneyFlowReceipt & { fundDividendPlan?: unknown };

interface NormalizedDividendPlan {
  fundId: ObjectId;
  fundName: string;
  fundSlug: string;
  fundTicker: string;
  anchorCurrencyCode: string;
  quotedNav: number;
  corporationId: ObjectId;
  corporationName?: string;
  sharesHeld: number;
  grossAnchor: number;
  reinvestAnchor: number;
  retainedAnchor: number;
  distributedAnchor: number;
  holdersPaid: number;
  recipients: FundDividendRecipient[];
  fundFxRate: number;
  forexEnabled: boolean;
  turn: number;
  now: Date;
  outcome?: FundDividendOutcome;
}

function planFromInput(live: FundDividendSpendInput, now: Date): NormalizedDividendPlan {
  return {
    fundId: live.fundId,
    fundName: live.fundName,
    fundSlug: live.fundSlug,
    fundTicker: live.fundTicker,
    anchorCurrencyCode: live.anchorCurrencyCode,
    quotedNav: live.quotedNav,
    corporationId: live.corporationId,
    ...(live.corporationName !== undefined ? { corporationName: live.corporationName } : {}),
    sharesHeld: live.sharesHeld,
    grossAnchor: live.grossAnchor,
    reinvestAnchor: live.reinvestAnchor,
    retainedAnchor: live.retainedAnchor,
    distributedAnchor: live.distributedAnchor,
    holdersPaid: live.holdersPaid,
    recipients: live.recipients.map((r) => ({ ...r })),
    fundFxRate: live.fundFxRate,
    forexEnabled: live.forexEnabled,
    turn: live.turn,
    now,
  };
}

function planFromStored(stored: FundDividendStoredPlan): NormalizedDividendPlan {
  return {
    fundId: new ObjectId(stored.fundIdHex),
    fundName: stored.fundName,
    fundSlug: stored.fundSlug,
    fundTicker: stored.fundTicker,
    anchorCurrencyCode: stored.anchorCurrencyCode,
    quotedNav: stored.quotedNav,
    corporationId: new ObjectId(stored.corporationIdHex),
    ...(stored.corporationName !== undefined ? { corporationName: stored.corporationName } : {}),
    sharesHeld: stored.sharesHeld,
    grossAnchor: stored.grossAnchor,
    reinvestAnchor: stored.reinvestAnchor,
    retainedAnchor: stored.retainedAnchor,
    distributedAnchor: stored.distributedAnchor,
    holdersPaid: stored.holdersPaid,
    recipients: stored.recipients.map((r) => ({
      holderKind: r.holderKind,
      holderId: new ObjectId(r.holderIdHex),
      holderName: r.holderName,
      units: r.units,
      amountAnchor: r.amountAnchor,
      amountNative: r.amountNative,
    })),
    fundFxRate: stored.fundFxRate,
    forexEnabled: stored.forexEnabled,
    turn: stored.turn,
    now: new Date(stored.nowIso),
    outcome:
      stored.outcome && isFundDividendOutcome(stored.outcome) ? { ...stored.outcome } : undefined,
  };
}

function planOutcome(plan: NormalizedDividendPlan): FundDividendOutcome {
  if (plan.outcome) return { ...plan.outcome };
  // A completed receipt always carries the stored outcome; this fallback only
  // runs when the process crashed between settling `completed` and writing
  // the outcome row. Every number is pinned in the plan, so no live read is
  // needed and the report is exactly the attempted distribution.
  return {
    grossAnchor: plan.grossAnchor,
    retainedAnchor: plan.retainedAnchor,
    distributedAnchor: plan.distributedAnchor,
    holdersPaid: plan.holdersPaid,
  };
}

function mapDividendError(stepName: string, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical surface: the fund credit is step zero, so its
  // failure settles `failed` with nothing applied (the old code threw before
  // any write when the fund row was gone); a later holder failure compensates
  // the applied prefix (the old code had no such path — a vanished holder
  // mid-write stranded a partial distribution — so failing closed here is the
  // crash-safe replacement, and the pass skips just that accrual).
  if (stepName === "fund-credit") return new Error(`${FUND_DIVIDEND_FUND}:${outcome}`);
  if (stepName === "dividend-tx" || stepName === "reinvest-tx") {
    return new Error(`${FUND_DIVIDEND_TX}:${outcome}`);
  }
  return new Error(`${FUND_DIVIDEND_HOLDER}:${outcome}`);
}

function buildDividendSteps(db: Db, key: string, plan: NormalizedDividendPlan): MoneyFlowStep[] {
  const funds = db.collection<MoneyFlowAccount>("indexFunds");
  const txs = db.collection<IndexFundTransaction>("indexFundTransactions");
  const steps: MoneyFlowStep[] = [];

  // The legacy two fund writes (75% reinvest up front, floored remainder
  // after) are additive $incs on one document, so they collapse into one
  // keyed leg: two legs on one document under one key would collide, the
  // first leg's key record tripping the second leg's `$ne: key` guard and
  // silently skipping the second credit.
  if (plan.retainedAnchor !== 0) {
    steps.push(
      makeLegStep(deriveMoneyFlowKey(key, "fund-credit"), {
        name: "fund-credit",
        collection: funds,
        docId: plan.fundId,
        field: "cashAnchor",
        delta: plan.retainedAnchor,
        set: { updatedAt: plan.now },
      })
    );
  }

  // One resumable credit per pinned recipient, in position order (the legacy
  // write order). Each carries its own derived subkey, so a crash between any
  // two holders resumes per holder: applied holders reconcile as duplicates
  // while the rest still land. A resumed distribution never pays a holder
  // twice and never recomputes from changed ownership.
  for (const recipient of plan.recipients) {
    const stepName = `holder:${recipient.holderKind}:${recipient.holderId.toHexString()}`;
    const subKey = deriveMoneyFlowKey(
      key,
      "holder",
      recipient.holderKind,
      recipient.holderId.toHexString()
    );
    if (recipient.holderKind === "npp") {
      steps.push(
        makeLegStep(subKey, {
          name: stepName,
          collection: db.collection<MoneyFlowAccount>("npps"),
          docId: recipient.holderId,
          field: "nppInvestmentCashAnchor",
          delta: recipient.amountAnchor,
          set: { updatedAt: plan.now },
        })
      );
      continue;
    }
    const collectionName =
      recipient.holderKind === "character" ? "characters" : "imperialCharacters";
    const inc = buildPersonalBalanceInc(
      recipient.amountNative,
      plan.anchorCurrencyCode as CurrencyCode,
      plan.forexEnabled
    );
    const entries = Object.entries(inc);
    const [field, delta] = entries[0]!;
    const extraIncs = Object.fromEntries(entries.slice(1));
    steps.push(
      makeLegStep(subKey, {
        name: stepName,
        collection: db.collection<MoneyFlowAccount>(collectionName),
        docId: recipient.holderId,
        field,
        delta,
        ...(Object.keys(extraIncs).length > 0 ? { extraIncs } : {}),
        set: { updatedAt: plan.now },
      })
    );
  }

  // Terminal audit rows: nothing runs after them, so they carry no inverse. A
  // survived insert error compensates the prefix instead of stranding paid
  // cash with no audit row. The `_id`s derive from the flow key, so a crash
  // between an insert and the receipt completion converges instead of
  // duplicating the row. Content matches the legacy rows exactly (kind,
  // corp, shares, NAV, amounts, notes), only the `_id` generation changed.
  const passThroughNote = `Dividend pass-through: ${plan.distributedAnchor.toFixed(2)}₳ to ${plan.holdersPaid} holders`;
  const retainedNote = `Dividend retained: ${plan.retainedAnchor.toFixed(2)}₳ to fund cash`;
  steps.push(
    makeInsertStep("dividend-tx", txs, {
      _id: keyedInsertId(key, PASS_THROUGH_TX_DOMAIN),
      fundId: plan.fundId,
      kind: "dividend_pass_through",
      corporationId: plan.corporationId,
      shares: plan.sharesHeld,
      navAnchor: plan.quotedNav,
      amountAnchor: plan.distributedAnchor,
      note: passThroughNote,
      createdAt: plan.now,
    } satisfies IndexFundTransaction)
  );
  steps.push(
    makeInsertStep("reinvest-tx", txs, {
      _id: keyedInsertId(key, REINVEST_TX_DOMAIN),
      fundId: plan.fundId,
      kind: "dividend_reinvest",
      corporationId: plan.corporationId,
      shares: plan.sharesHeld,
      navAnchor: plan.quotedNav,
      amountAnchor: plan.retainedAnchor,
      note: retainedNote,
      createdAt: plan.now,
    } satisfies IndexFundTransaction)
  );

  return steps;
}

/**
 * Distribute one index-fund dividend (fund cash credit + per-holder credits +
 * two audit rows) so the result is exactly-once on every topology (issue
 * #1672).
 *
 * Step order mirrors the historical write order (fund reinvest, holder
 * credits, audit rows), and a later-step failure compensates its own prefix
 * (fund refunded, credited holders clawed back) instead of leaving a strand
 * where the fund kept cash but holders were never paid, or some holders were
 * paid twice.
 *
 * Fan-out keying: every step carries its own idempotent sub-operation key
 * derived from the flow key via `deriveMoneyFlowKey` (`fund-credit` plus one
 * `holder:<kind>:<id>` suffix per recipient, plus the deterministic audit-row
 * `_id`s), so a crash between any two writes resumes per step: applied steps
 * report `already-applied` and are skipped while the rest still land.
 *
 * The caller (the dividend pass) owns everything ambient: the fund read, the
 * ownership snapshot, the FX-availability gate, the 75/25 split, the per-unit
 * math, and the 2dp flooring. Those arrive here as pinned amounts on the
 * input and are persisted on the receipt plan at claim time, so a same-key
 * retry never recomputes them from post-debit state or changed ownership.
 *
 * Under real transactions the fund credit, the holder credits, the audit
 * rows, and the idempotency receipt join the transaction and commit
 * atomically, preserving the old behavior. On a standalone deployment the
 * fallback runs the same writes as keyed idempotent steps: a crash between
 * them leaves an `in_progress` receipt, and retrying with the same key and
 * fingerprint reconciles to exactly one distribution. A retry after a
 * terminal failure throws `MoneyFlowTerminalError` (fail closed); a new
 * attempt needs a new key.
 */
export async function applyFundDividendSpend(
  db: Db,
  input: FundDividendSpendInput
): Promise<{ duplicate: boolean; outcome: FundDividendOutcome }> {
  if (!input.fundId) {
    throw new TypeError("Fund dividend spend needs fundId");
  }
  if (!input.corporationId) {
    throw new TypeError("Fund dividend spend needs corporationId");
  }
  if (typeof input.anchorCurrencyCode !== "string" || input.anchorCurrencyCode.length === 0) {
    throw new TypeError("Fund dividend spend needs anchorCurrencyCode");
  }
  if (!Number.isFinite(input.grossAnchor) || input.grossAnchor <= 0) {
    throw new RangeError("Fund dividend grossAnchor must be a positive finite amount");
  }
  if (!Number.isFinite(input.reinvestAnchor) || input.reinvestAnchor < 0) {
    throw new RangeError("Fund dividend reinvestAnchor must be a finite non-negative amount");
  }
  if (!Number.isFinite(input.retainedAnchor) || input.retainedAnchor < 0) {
    throw new RangeError("Fund dividend retainedAnchor must be a finite non-negative amount");
  }
  if (!Number.isFinite(input.distributedAnchor) || input.distributedAnchor < 0) {
    throw new RangeError("Fund dividend distributedAnchor must be a finite non-negative amount");
  }
  if (!Number.isInteger(input.holdersPaid) || input.holdersPaid < 0) {
    throw new RangeError("Fund dividend holdersPaid must be a non-negative integer");
  }
  if (input.holdersPaid !== input.recipients.length) {
    throw new RangeError("Fund dividend holdersPaid must match the recipient count");
  }
  if (!Number.isFinite(input.fundFxRate) || input.fundFxRate < 0) {
    throw new RangeError("Fund dividend fundFxRate must be a finite non-negative amount");
  }
  if (!Number.isInteger(input.turn)) {
    throw new TypeError("Fund dividend spend needs an integer turn");
  }
  for (const recipient of input.recipients) {
    if (!recipient.holderId) {
      throw new TypeError("Fund dividend recipient needs holderId");
    }
    // NPP recipients carry no display name: the legacy path never read one
    // (NPP credits take no audit entry), so there is nothing to pin.
    if (
      recipient.holderKind !== "npp" &&
      (typeof recipient.holderName !== "string" || recipient.holderName.length === 0)
    ) {
      throw new TypeError("Fund dividend recipient needs holderName");
    }
    if (!Number.isFinite(recipient.units) || recipient.units <= 0) {
      throw new RangeError("Fund dividend recipient units must be positive");
    }
    if (!Number.isFinite(recipient.amountAnchor) || recipient.amountAnchor <= 0) {
      throw new RangeError("Fund dividend recipient amountAnchor must be positive");
    }
    if (!Number.isFinite(recipient.amountNative) || recipient.amountNative < 0) {
      throw new RangeError("Fund dividend recipient amountNative must be finite non-negative");
    }
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Fund dividend idempotency key must be 1-128 characters");
  }

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<FundDividendReceipt>;
  const now = new Date();

  const persistOutcome = async (
    plan: NormalizedDividendPlan,
    opts: { session?: ClientSession }
  ): Promise<FundDividendOutcome> => {
    const outcome = planOutcome(plan);
    await receiptCollection.updateOne(
      { _id: key },
      {
        $set: {
          fundDividendPlan: { ...toStoredPlanLike(plan), outcome },
          updatedAt: new Date(),
        },
      },
      opts.session ? { session: opts.session } : {}
    );
    return outcome;
  };

  const runPlan = async (
    plan: NormalizedDividendPlan,
    opts: { session?: ClientSession }
  ): Promise<FundDividendOutcome> => {
    await runMoneyFlowSteps(
      receipts,
      key,
      buildDividendSteps(db, key, plan),
      (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome) =>
        mapDividendError(step.name, outcome),
      opts
    );
    return persistOutcome(plan, opts);
  };

  const runSpend = async (
    session?: ClientSession
  ): Promise<{ duplicate: boolean; outcome: FundDividendOutcome }> => {
    const opts = session ? { session } : {};
    let claim: Awaited<ReturnType<typeof claimMoneyFlowReceipt>>;
    try {
      claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    } catch (err) {
      if (!(err instanceof MoneyFlowKeyConflictError)) throw err;
      // Same key, different fingerprint. The pass keys one distribution per
      // fund, corp, turn, and gross and never recomputes a live split for a
      // settled turn, so a conflict here is a genuinely different distribution
      // reusing the key, not a post-crash remainder: fail closed. (Crash
      // recovery resumes by key through `resumeFundDividendByKey`, which
      // rebuilds from the stored plan without presenting a live fingerprint
      // at all.)
      throw err;
    }
    if (claim === "duplicate") {
      const existing = await receiptCollection.findOne({ _id: key }, opts);
      const stored = existing?.fundDividendPlan;
      if (!isStoredPlan(stored)) {
        throw new Error("MONEY_FLOW_RECEIPT_LOST");
      }
      return { duplicate: true, outcome: await persistOutcome(planFromStored(stored), opts) };
    }
    if (claim === "in-progress") {
      // Same fingerprint, so the live input names the same distribution — but
      // the steps run from the STORED plan when one exists, never the live
      // input: post-crash reads are post-debit state under possibly changed
      // ownership and would double-pay or misprice. No stored plan means the
      // crash landed between the claim insert and the plan write below
      // (nothing applied yet), so the live input under the stored fingerprint
      // is exact.
      const existing = await receiptCollection.findOne({ _id: key }, opts);
      const stored = existing?.fundDividendPlan;
      const plan = isStoredPlan(stored) ? planFromStored(stored) : planFromInput(input, now);
      const outcome = await runPlan(plan, opts);
      emitHolderEntries(plan, false);
      return { duplicate: true, outcome };
    }
    // A fresh claim owns the attempt. Persist the resume plan before the
    // first step: a crash from here on resumes this exact plan under the same
    // key.
    try {
      await receiptCollection.updateOne(
        { _id: key },
        { $set: { fundDividendPlan: toStoredPlan(input, now), updatedAt: new Date() } },
        opts
      );
    } catch (planError) {
      await failMoneyFlowReceipt(receipts, key, `${FUND_DIVIDEND_TX}:plan-store`, opts);
      throw planError;
    }

    const plan = planFromInput(input, now);
    const outcome = await runPlan(plan, opts);
    emitHolderEntries(plan, true);
    return { duplicate: false, outcome };
  };

  /** Post-commit holder audit entries (best effort, fresh attempt only). */
  function emitHolderEntries(plan: NormalizedDividendPlan, fresh: boolean): void {
    if (!fresh) return;
    if (plan.recipients.length === 0) return;
    const emit = async (): Promise<void> => {
      const { logIndexFundDividendBulk, buildIndexFundDividendTxEntry } =
        await import("@/lib/indexFunds/fundTxLog");
      const fundRef = {
        _id: plan.fundId,
        slug: plan.fundSlug,
        name: plan.fundName,
        tickerSymbol: plan.fundTicker,
        anchorCurrencyCode: plan.anchorCurrencyCode,
      };
      const entries = plan.recipients
        .filter((r) => r.holderKind === "character" || r.holderKind === "imperial_character")
        .map((r) =>
          buildIndexFundDividendTxEntry({
            fund: fundRef,
            holder: {
              holderKind: r.holderKind,
              holderId: r.holderId,
              holderName: r.holderName,
            },
            amountAnchor: r.amountAnchor,
            amountNative: r.amountNative,
            units: r.units,
            corporationId: plan.corporationId,
            ...(plan.corporationName !== undefined
              ? { corporationName: plan.corporationName }
              : {}),
            turn: plan.turn,
            createdAt: plan.now,
          })
        );
      await logIndexFundDividendBulk(db, entries);
    };
    void emit().catch(() => {
      // Best effort like the legacy fire-and-forget log: the money already
      // moved under keyed steps, and a log failure must not fail the turn.
    });
  }

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}

export interface FundDividendResumeResult {
  /** Stored distribution numbers for the resumed attempt. */
  outcome: FundDividendOutcome;
}

/**
 * Key-only crash recovery for one fund dividend distribution (issue #1672): a
 * same-turn re-run of the dividend pass resumes under the stored key, so no
 * receipt strands `in_progress` and no holder is paid twice.
 *
 * Returns null when there is nothing to resume (no receipt under the key, an
 * already-`completed` receipt, or an `in_progress` receipt with no usable
 * stored plan). Throws `MoneyFlowTerminalError` when the receipt settled
 * `failed`/`compensated`, and `MoneyFlowKeyConflictError` when the stored
 * attempt names a different fund or corporation (fail closed on cross-key
 * reuse).
 */
export async function resumeFundDividendByKey(
  db: Db,
  key: string,
  expectedFundId: ObjectId,
  expectedCorporationId: ObjectId
): Promise<FundDividendResumeResult | null> {
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Fund dividend idempotency key must be 1-128 characters");
  }
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<FundDividendReceipt>;
  const existing = await receiptCollection.findOne({ _id: key });
  if (!existing) return null;
  const stored = existing.fundDividendPlan;
  if (existing.status === "completed") {
    if (
      isStoredPlan(stored) &&
      (stored.fundIdHex !== expectedFundId.toHexString() ||
        stored.corporationIdHex !== expectedCorporationId.toHexString())
    ) {
      throw new MoneyFlowKeyConflictError(key);
    }
    return null;
  }
  if (existing.status === "failed" || existing.status === "compensated") {
    throw new MoneyFlowTerminalError(key, existing.status);
  }
  if (existing.status !== "in_progress") return null;
  // Crashed between the claim insert and the plan write: nothing applied yet,
  // and the dividend accrues again on the next pass under a new key, so there
  // is nothing to resume here.
  if (!isStoredPlan(stored)) return null;
  if (
    stored.fundIdHex !== expectedFundId.toHexString() ||
    stored.corporationIdHex !== expectedCorporationId.toHexString()
  ) {
    throw new MoneyFlowKeyConflictError(key);
  }
  const plan = planFromStored(stored);
  const mapError = (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error =>
    mapDividendError(step.name, outcome);
  let outcome: FundDividendOutcome;
  await runWithOptionalTransaction(
    async (session) => {
      await runMoneyFlowSteps(receipts, key, buildDividendSteps(db, key, plan), mapError, {
        session,
      });
      outcome = await persistResumeOutcome(receiptCollection, key, plan, { session });
    },
    async () => {
      await runMoneyFlowSteps(receipts, key, buildDividendSteps(db, key, plan), mapError);
      outcome = await persistResumeOutcome(receiptCollection, key, plan, {});
    }
  );
  return { outcome: outcome! };
}

async function persistResumeOutcome(
  receiptCollection: Collection<FundDividendReceipt>,
  key: string,
  plan: NormalizedDividendPlan,
  opts: { session?: ClientSession }
): Promise<FundDividendOutcome> {
  const outcome = planOutcome(plan);
  await receiptCollection.updateOne(
    { _id: key },
    {
      $set: {
        fundDividendPlan: { ...toStoredPlanLike(plan), outcome },
        updatedAt: new Date(),
      },
    },
    opts.session ? { session: opts.session } : {}
  );
  return outcome;
}

/** Rebuild a storable plan snapshot from a normalized plan (for outcome writes). */
function toStoredPlanLike(plan: NormalizedDividendPlan): FundDividendStoredPlan {
  return {
    version: 1,
    fundIdHex: plan.fundId.toHexString(),
    fundName: plan.fundName,
    fundSlug: plan.fundSlug,
    fundTicker: plan.fundTicker,
    anchorCurrencyCode: plan.anchorCurrencyCode,
    quotedNav: plan.quotedNav,
    corporationIdHex: plan.corporationId.toHexString(),
    ...(plan.corporationName !== undefined ? { corporationName: plan.corporationName } : {}),
    sharesHeld: plan.sharesHeld,
    grossAnchor: plan.grossAnchor,
    reinvestAnchor: plan.reinvestAnchor,
    retainedAnchor: plan.retainedAnchor,
    distributedAnchor: plan.distributedAnchor,
    holdersPaid: plan.holdersPaid,
    recipients: plan.recipients.map((r) => ({
      holderKind: r.holderKind,
      holderIdHex: r.holderId.toHexString(),
      holderName: r.holderName,
      units: r.units,
      amountAnchor: r.amountAnchor,
      amountNative: r.amountNative,
    })),
    fundFxRate: plan.fundFxRate,
    forexEnabled: plan.forexEnabled,
    turn: plan.turn,
    nowIso: plan.now.toISOString(),
    ...(plan.outcome ? { outcome: { ...plan.outcome } } : {}),
  };
}
