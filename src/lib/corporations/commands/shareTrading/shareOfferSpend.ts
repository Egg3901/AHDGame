import { randomUUID } from "node:crypto";
import { ObjectId, type Collection, type Db, type Filter } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  deriveMoneyFlowKey,
  failMoneyFlowReceipt,
  keyedInsertId,
  MoneyFlowTerminalError,
  runMoneyFlowSteps,
  NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION,
  type MoneyFlowLegOutcome,
  type MoneyFlowReceipt,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import {
  makeCapCreditStep,
  makeCashStep,
  type ShareFillCapLeg,
  type ShareFillCashLeg,
} from "@/lib/corporations/commands/shareTrading/shareFillMoney";
import {
  makeSpreadDistributionSteps,
  type SpreadDistributionSpec,
} from "@/lib/currency/spreadFees";
import { getCountryForCurrency } from "@/lib/currency/marketMaker";
import { emitTx } from "@/lib/financialTxLog/emit";
import type { ShareListing } from "@/lib/db/types";

/**
 * Keyed money flows for private-listing share offers (issue #1672).
 *
 * submitShareOffer.ts charged escrow with an atomic guarded debit, then
 * inserted the offer row, then awaited the tx row, with manual refund/delete
 * compensation: a crash between the debit and the insert stranded escrow
 * with no offer (no receipt existed, so no retry could converge it), a
 * crash between the insert and the tx row retried into a duplicate-pending
 * refund, and the corp-branch FX spread routed outside any exactly-once
 * boundary (a post-commit crash lost it, a retried request double-routed
 * it). acceptShareOffer.ts claimed the offer and decremented the listing
 * with bare conditional writes and a hand-rolled rollback array: a crash
 * between the share credit and the seller proceeds left the buyer with
 * shares the seller was never paid for, a crash between proceeds and the
 * partial-refund double-paid on manual retry, and concurrent accepts could
 * both pass the pre-read and over-accept past sharesRemaining.
 *
 * This module runs both as one keyed money flow each, following the
 * share-order-placement / listing-cancel conventions:
 *
 * - One receipt per attempt. Routes forward the client `Idempotency-Key`
 *   (minted when absent). Same-key retries converge on the stored plan and
 *   return the stored outcome; a key reused with a different fingerprint
 *   throws `MoneyFlowKeyConflictError` (fail closed); a key that settled
 *   without completing throws `MoneyFlowTerminalError`.
 * - The route-facing shells keep every read-only guard with byte-identical
 *   validation order and error strings and pin every amount, currency
 *   field, party, and response figure BEFORE the flow starts. The flow
 *   stores that immutable plan on the receipt before the first step, so
 *   recovery replays stored figures instead of re-reading post-attempt
 *   state (FX drift between attempt and retry cannot move money).
 * - Submit: guarded escrow debit (character home-currency field or corp
 *   liquidCapital, same `$gte` guard the legacy atomic debits used) plus a
 *   deterministic-`_id` offer insert (a crash between debit and insert
 *   converges on retry instead of stranding debited-with-no-offer rows)
 *   plus the corp-branch FX spread as keyed bank steps (exactly once, not
 *   post-commit). The pending-unique race (two concurrent submits both
 *   passing the route pre-check) converges via the unique index: the loser
 *   compensates its debit and reports the legacy `already have a pending
 *   offer` 400. The escrow tx row is post-commit best effort with a
 *   deterministic `_id` (replays converge instead of duplicating it).
 * - Accept: CAS offer claim (`pending` to `accepted`, stamped with the
 *   flow key; a lost race reports the legacy 409) plus CAS listing decrement
 *   (`open` + `sharesRemaining $gte`, stamped; a lost race disambiguates
 *   into the legacy 404/400/400-concurrent messages from a fresh read),
 *   the conditional `filled` flip as a naturally idempotent post-claim
 *   write, buyer cap-table credit via the shared keyed cap step, seller
 *   proceeds and partial-refund credits as keyed cash steps. `runMoneyFlowSteps`
 *   reverses the applied prefix with keyed inverses before settling, so the
 *   flow ends `completed` or terminal without effect, never partial. The
 *   sell/refund tx rows are post-commit best effort with deterministic
 *   `_id`s; trade history, buyer notification, and takeover-threshold
 *   checks stay fire-and-forget in the shell like the legacy.
 *
 * Legacy economics and API behavior are preserved: identical escrow math
 * (anchor-normalized, same rounding), identical spread split and banks,
 * identical tx shapes, identical error strings and statuses, identical
 * response bodies (submit `{ escrowAmount, spreadPaid }`, accept
 * `{ sharesTransferred, proceeds, refundedToOffer, listingSharesRemaining }`
 * with the anchor-unit proceeds/refund the legacy returned).
 */

export const SHARE_OFFER_SUBMIT_FINGERPRINT_DOMAIN = "share-offer-submit";
export const SHARE_OFFER_SUBMIT_TX_DOMAIN = "share-offer-submit-tx";
export const SHARE_OFFER_ACCEPT_FINGERPRINT_DOMAIN = "share-offer-accept";
export const SHARE_OFFER_ACCEPT_TX_DOMAIN = "share-offer-accept-tx";

// ---------------------------------------------------------------------------
// Submit (escrow) flow
// ---------------------------------------------------------------------------

/** Immutable resume plan pinned before the first submit step. */
export interface ShareOfferSubmitPlan {
  version: 1;
  submitKey: string;
  listingIdHex: string;
  corpIdHex: string;
  buyerCharacterIdHex: string;
  /** Null for a personal offer. */
  buyerCorporationIdHex: string | null;
  shares: number;
  pricePerShare: number;
  /** Escrow in the listing corp's liquid currency (legacy response figure). */
  escrowAmount: number;
  /** Guarded escrow debit on the payer's own balance field. */
  escrowDebit: ShareFillCashLeg;
  payerType: "character" | "corporation";
  payerIdHex: string;
  payerName: string;
  payerCurrencyCode: string;
  /** Pinned legacy insufficient-funds message (the corp variant embeds figures). */
  insufficientError: string;
  turn: number;
  nowIso: string;
  /** Deterministic offer `_id` (keyedInsertId over the submit key). */
  offerIdHex: string;
  /** Corp-branch FX spread, pinned. Null for personal offers and same-currency. */
  spread: { fee: number; from: CurrencyCode; to: CurrencyCode } | null;
  /** Stored at settle; replays return it verbatim. */
  response: { escrowAmount: number; spreadPaid: number };
}

/** Deterministic offer `_id` for a submit key (shared by the shell and the insert step). */
export function buildShareOfferSubmitOfferId(submitKey: string): ObjectId {
  return keyedInsertId(submitKey, "share-offer-submit");
}

export function isShareOfferSubmitPlan(value: unknown): value is ShareOfferSubmitPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.version === 1 &&
    typeof plan.submitKey === "string" &&
    typeof plan.listingIdHex === "string" &&
    typeof plan.escrowDebit === "object" &&
    plan.escrowDebit !== null &&
    typeof plan.offerIdHex === "string" &&
    typeof plan.response === "object" &&
    plan.response !== null
  );
}

/** Fingerprint covers the listing, buyer, size/price, and the pinned debit. */
export function buildShareOfferSubmitFingerprint(plan: ShareOfferSubmitPlan): string {
  const cents = (n: number): string => String(Math.round(n * 100) / 100);
  const leg = plan.escrowDebit;
  return [
    SHARE_OFFER_SUBMIT_FINGERPRINT_DOMAIN,
    plan.listingIdHex,
    plan.buyerCharacterIdHex,
    plan.buyerCorporationIdHex ?? "none",
    `shares:${plan.shares}`,
    `price:${cents(plan.pricePerShare)}`,
    `debit:${leg.collection}:${leg.idHex}:${leg.field}:${cents(leg.amount)}`,
    plan.spread
      ? `spread:${cents(plan.spread.fee)}:${plan.spread.from}:${plan.spread.to}`
      : "spread:none",
  ].join(":");
}

export type ShareOfferSubmitFlowResult =
  | { ok: true; body: { escrowAmount: number; spreadPaid: number }; replayed: boolean }
  | { ok: false; error: string };

type ShareOfferSubmitReceipt = MoneyFlowReceipt & {
  shareOfferSubmitPlan?: unknown;
  shareOfferSubmitResponse?: unknown;
};

function receipts(db: Db): Collection<MoneyFlowReceipt> {
  return db.collection<MoneyFlowReceipt>(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION);
}

function receiptsSubmitEx(db: Db): Collection<ShareOfferSubmitReceipt> {
  return db.collection<ShareOfferSubmitReceipt>(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION);
}

interface StampedAccount {
  _id: ObjectId;
  appliedMoneyFlowKeys?: string[];
}

function isDuplicateKeyError(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: unknown }).code === 11000;
}

/**
 * Deterministic offer insert. The `_id` derives from the submit key, so a
 * same-key retry converges to `already-applied` instead of stranding a
 * second debit or a duplicate row. A duplicate key WITHOUT our `_id` on
 * file means a competing attempt won the pending-unique
 * (listingId, buyerCharacterId) race: converge as `guard-rejected` so the
 * debit compensates and the caller reports the legacy pending-offer 400.
 * The revert is conditional on the row still being pending (an accept that
 * landed between insert and a later failure must never be deleted).
 */
function makeOfferInsertStep(db: Db, plan: ShareOfferSubmitPlan): MoneyFlowStep {
  const offers = db.collection<StampedAccount>("shareOffers");
  const offerId = new ObjectId(plan.offerIdHex);
  const now = new Date(plan.nowIso);
  return {
    name: "offer-insert",
    apply: async () => {
      const doc: Record<string, unknown> = {
        _id: offerId,
        listingId: new ObjectId(plan.listingIdHex),
        corporationId: new ObjectId(plan.corpIdHex),
        buyerCharacterId: new ObjectId(plan.buyerCharacterIdHex),
        shares: plan.shares,
        pricePerShare: plan.pricePerShare,
        escrowAmount: plan.escrowAmount,
        status: "pending",
        lastShareOfferSubmitKey: plan.submitKey,
        createdAt: now,
      };
      if (plan.buyerCorporationIdHex) {
        doc.buyerCorporationId = new ObjectId(plan.buyerCorporationIdHex);
      }
      try {
        await offers.insertOne(doc as never);
        return "applied" as MoneyFlowLegOutcome;
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        const mine = await offers.findOne({ _id: offerId } as Filter<StampedAccount>, {
          projection: { _id: 1 },
        });
        if (mine) return "already-applied" as MoneyFlowLegOutcome;
        return "guard-rejected" as MoneyFlowLegOutcome;
      }
    },
    revert: async () => {
      await offers.deleteOne({ _id: offerId, status: "pending" } as Filter<StampedAccount>);
      return "already-applied" as MoneyFlowLegOutcome;
    },
  };
}

/** Step build shared by first attempt and crash recovery (from the stored plan). */
export function buildShareOfferSubmitSteps(db: Db, plan: ShareOfferSubmitPlan): MoneyFlowStep[] {
  const now = new Date(plan.nowIso);
  const steps: MoneyFlowStep[] = [];
  // A zero escrow (a zero-price offer inside the 50%-of-zero bound) debits
  // nothing: `$inc` by zero is a no-op, so dropping the step changes no
  // balance, mirroring the legacy atomic debit.
  if (plan.escrowDebit.amount !== 0) {
    steps.push(
      makeCashStep(
        db,
        "escrow-debit",
        deriveMoneyFlowKey(plan.submitKey, "escrow-debit"),
        plan.escrowDebit,
        true,
        now
      )
    );
  }
  steps.push(makeOfferInsertStep(db, plan));
  if (plan.spread) {
    const fromCountryId = getCountryForCurrency(plan.spread.from);
    const toCountryId = getCountryForCurrency(plan.spread.to);
    if (fromCountryId) {
      const spec: SpreadDistributionSpec = {
        totalFee: plan.spread.fee,
        sourceCountryId: fromCountryId,
        currencyCode: plan.spread.from,
        ...(toCountryId ? { destinationCountryId: toCountryId } : {}),
      };
      steps.push(
        ...makeSpreadDistributionSteps(
          db,
          deriveMoneyFlowKey(plan.submitKey, "escrow-spread"),
          spec
        )
      );
    }
    // No source country: legacy distributeConversionSpread no-ops, so no
    // steps either (same short-circuit as the forex fill flows).
  }
  return steps;
}

function mapSubmitError(plan: ShareOfferSubmitPlan) {
  return (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error => {
    if (step.name === "escrow-debit") {
      return new Error(`SHARE_OFFER_SUBMIT:400:${plan.insufficientError}`);
    }
    if (step.name === "offer-insert") {
      return new Error("SHARE_OFFER_SUBMIT:400:You already have a pending offer on this listing");
    }
    return new Error(`share-offer-submit:${step.name}:${outcome}`);
  };
}

function submitErrorOf(error: Error): { error: string; status: number } {
  const match = /^SHARE_OFFER_SUBMIT:(\d+):([\s\S]*)$/.exec(error.message);
  if (match) return { error: match[2]!, status: Number(match[1]) };
  throw error;
}

/** Post-commit best-effort escrow tx row with a deterministic id (replays converge). */
async function emitSubmitTxBestEffort(db: Db, plan: ShareOfferSubmitPlan): Promise<void> {
  try {
    await emitTx(
      db,
      {
        type: "share_offer_escrow",
        turn: plan.turn,
        createdAt: new Date(plan.nowIso),
        subjectType: plan.payerType,
        subjectId: new ObjectId(plan.payerIdHex),
        subjectName: plan.payerName,
        amount: -Math.round(plan.escrowDebit.amount * 100) / 100,
        currencyCode: plan.payerCurrencyCode as CurrencyCode,
        counterpartyType: "system",
        counterpartyName: "Private listing escrow",
        meta: {
          listingId: plan.listingIdHex,
          corporationId: plan.corpIdHex,
          shares: plan.shares,
          pricePerShare: plan.pricePerShare,
        },
      },
      undefined,
      { _id: keyedInsertId(plan.submitKey, SHARE_OFFER_SUBMIT_TX_DOMAIN) }
    );
  } catch {
    // Best effort, like every other migrated flow's audit row.
  }
}

async function settleSubmitResponse(db: Db, plan: ShareOfferSubmitPlan): Promise<void> {
  try {
    await receiptsSubmitEx(db).updateOne(
      { _id: plan.submitKey },
      {
        $set: {
          "shareOfferSubmitPlan.response": plan.response,
          shareOfferSubmitResponse: plan.response,
          updatedAt: new Date(),
        },
      }
    );
  } catch {
    // Response store is best effort; the receipt already settled `completed`.
  }
}

async function runSubmitPostCommit(db: Db, plan: ShareOfferSubmitPlan): Promise<void> {
  await emitSubmitTxBestEffort(db, plan);
}

async function runStoredSubmitPlan(
  db: Db,
  submitKey: string,
  plan: ShareOfferSubmitPlan
): Promise<ShareOfferSubmitFlowResult> {
  try {
    await runMoneyFlowSteps(
      receipts(db),
      submitKey,
      buildShareOfferSubmitSteps(db, plan),
      mapSubmitError(plan)
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("SHARE_OFFER_SUBMIT:")) {
      const mapped = submitErrorOf(error);
      return { ok: false, error: mapped.error };
    }
    return { ok: false, error: "Failed to submit offer" };
  }
  await settleSubmitResponse(db, plan);
  await runSubmitPostCommit(db, plan);
  return { ok: true, body: plan.response, replayed: true };
}

/**
 * Execute one offer submit to exactly one terminal state. The plan is
 * already fully pinned by the caller; this claims the receipt, stores the
 * plan, runs the steps, and returns the legacy outcome body. Throws
 * MoneyFlowKeyConflictError / MoneyFlowTerminalError from the claim for the
 * route to map to 409.
 */
export async function executeShareOfferSubmitFlow(
  db: Db,
  plan: ShareOfferSubmitPlan,
  opts: { idempotencyKey?: string } = {}
): Promise<ShareOfferSubmitFlowResult> {
  const submitKey = opts.idempotencyKey ?? randomUUID();
  if (submitKey !== plan.submitKey) {
    throw new Error("share-offer-submit:key-mismatch");
  }
  const fingerprint = buildShareOfferSubmitFingerprint(plan);
  const claim = await claimMoneyFlowReceipt(receipts(db), submitKey, fingerprint);
  if (claim === "duplicate") {
    const stored = await receiptsSubmitEx(db).findOne({ _id: submitKey });
    if (stored?.shareOfferSubmitResponse && typeof stored.shareOfferSubmitResponse === "object") {
      return {
        ok: true,
        body: stored.shareOfferSubmitResponse as { escrowAmount: number; spreadPaid: number },
        replayed: true,
      };
    }
    const storedPlan = stored?.shareOfferSubmitPlan;
    if (isShareOfferSubmitPlan(storedPlan)) {
      return { ok: true, body: storedPlan.response, replayed: true };
    }
    return { ok: true, body: plan.response, replayed: true };
  }
  if (claim === "in-progress") {
    return recoverShareOfferSubmitByKey(db, submitKey);
  }

  try {
    await receiptsSubmitEx(db).updateOne(
      { _id: submitKey },
      { $set: { shareOfferSubmitPlan: { ...plan }, updatedAt: new Date() } }
    );
  } catch (planError) {
    await failMoneyFlowReceipt(receipts(db), submitKey, "share-offer-submit:plan-store");
    throw planError;
  }

  try {
    await runMoneyFlowSteps(
      receipts(db),
      submitKey,
      buildShareOfferSubmitSteps(db, plan),
      mapSubmitError(plan)
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("SHARE_OFFER_SUBMIT:")) {
      const mapped = submitErrorOf(error);
      return { ok: false, error: mapped.error };
    }
    throw error;
  }
  await settleSubmitResponse(db, plan);
  await runSubmitPostCommit(db, plan);
  return { ok: true, body: plan.response, replayed: false };
}

/**
 * Route-facing key lookup: when the client passed an explicit
 * `Idempotency-Key` with a receipt already on file, the retry reconciles
 * through the keyed steps instead of re-running the route guards. Returns
 * null when no receipt exists and the route must validate fresh.
 */
export async function getStoredShareOfferSubmitResponse(
  db: Db,
  submitKey: string
): Promise<{ settled: boolean } | null> {
  const receipt = await receiptsSubmitEx(db).findOne({ _id: submitKey });
  if (!receipt) return null;
  return { settled: receipt.status !== "in_progress" };
}

/**
 * Crash recovery for one submit receipt, from only the flow key: replays
 * the stored plan to convergence. A plan-less receipt settled here as
 * `failed` is truthful because the plan store precedes the first step, so
 * a missing plan means no step ever ran and nothing moved.
 */
export async function recoverShareOfferSubmitReceipt(
  db: Db,
  submitKey: string
): Promise<ShareOfferSubmitRecoveryResult> {
  const receipt = await receiptsSubmitEx(db).findOne({ _id: submitKey });
  if (!receipt) return { submitKey, action: "skipped-missing" };
  if (receipt.status !== "in_progress") return { submitKey, action: "skipped-settled" };
  const stored = receipt.shareOfferSubmitPlan;
  if (!isShareOfferSubmitPlan(stored)) {
    await failMoneyFlowReceipt(receipts(db), submitKey, "share-offer-submit:plan-never-stored");
    return { submitKey, action: "settled-failed-no-plan" };
  }
  const result = await runStoredSubmitPlan(db, submitKey, stored);
  return {
    submitKey,
    action: result.ok ? "submit-recovered" : "submit-incomplete",
  };
}

/**
 * Route- and caller-facing recovery: maps the receipt action onto the
 * legacy submit surface. Same-key retries converge here instead of
 * double-charging escrow.
 */
export async function recoverShareOfferSubmitByKey(
  db: Db,
  submitKey: string
): Promise<ShareOfferSubmitFlowResult> {
  const receipt = await receiptsSubmitEx(db).findOne({ _id: submitKey });
  if (!receipt) return { ok: false, error: "Offer submission did not complete; retry" };
  if (receipt.status === "completed") {
    if (receipt.shareOfferSubmitResponse && typeof receipt.shareOfferSubmitResponse === "object") {
      return {
        ok: true,
        body: receipt.shareOfferSubmitResponse as { escrowAmount: number; spreadPaid: number },
        replayed: true,
      };
    }
    const stored = receipt.shareOfferSubmitPlan;
    if (isShareOfferSubmitPlan(stored)) {
      return { ok: true, body: stored.response, replayed: true };
    }
    return { ok: false, error: "Offer submission did not complete; retry" };
  }
  if (receipt.status !== "in_progress") {
    throw new MoneyFlowTerminalError(submitKey, receipt.status, receipt.error);
  }
  const result = await recoverShareOfferSubmitReceipt(db, submitKey);
  switch (result.action) {
    case "submit-recovered":
    case "skipped-settled": {
      const settled = await receiptsSubmitEx(db).findOne({ _id: submitKey });
      if (
        settled?.shareOfferSubmitResponse &&
        typeof settled.shareOfferSubmitResponse === "object"
      ) {
        return {
          ok: true,
          body: settled.shareOfferSubmitResponse as { escrowAmount: number; spreadPaid: number },
          replayed: true,
        };
      }
      const stored = settled?.shareOfferSubmitPlan;
      if (isShareOfferSubmitPlan(stored)) {
        return { ok: true, body: stored.response, replayed: true };
      }
      return { ok: false, error: "Failed to submit offer" };
    }
    case "settled-failed-no-plan":
      return { ok: false, error: "Offer submission did not complete; retry with a new key" };
    case "skipped-missing":
      return { ok: false, error: "Offer submission did not complete; retry" };
    case "submit-incomplete": {
      const current = await receiptsSubmitEx(db).findOne({ _id: submitKey });
      return { ok: false, error: current?.error ?? "Failed to submit offer" };
    }
  }
}

export type ShareOfferSubmitRecoveryAction =
  | "submit-recovered"
  | "submit-incomplete"
  | "settled-failed-no-plan"
  | "skipped-settled"
  | "skipped-missing";

export interface ShareOfferSubmitRecoveryResult {
  submitKey: string;
  action: ShareOfferSubmitRecoveryAction;
}

/**
 * Bounded submit orphan scan for the periodic driver. Recovers every
 * `in_progress` submit receipt from its stored plan; plan-less receipts
 * settle `failed` (the plan store precedes the first step, so nothing
 * moved). Foreign-domain receipts stay out via the fingerprint prefix.
 */
export async function recoverShareOfferSubmitOrphans(
  db: Db,
  limit = 50
): Promise<ShareOfferSubmitRecoveryResult[]> {
  const stuck = await receiptsSubmitEx(db)
    .find({ status: "in_progress", shareOfferSubmitPlan: { $exists: true } })
    .limit(limit)
    .toArray();
  const results: ShareOfferSubmitRecoveryResult[] = [];
  for (const receipt of stuck) {
    const stored = receipt.shareOfferSubmitPlan;
    if (!isShareOfferSubmitPlan(stored)) {
      await failMoneyFlowReceipt(receipts(db), receipt._id, "share-offer-submit:plan-never-stored");
      results.push({ submitKey: receipt._id, action: "settled-failed-no-plan" });
      continue;
    }
    const result = await runStoredSubmitPlan(db, receipt._id, stored);
    results.push({
      submitKey: receipt._id,
      action: result.ok ? "submit-recovered" : "submit-incomplete",
    });
  }
  if (results.length >= limit) return results;
  const planless = await receiptsSubmitEx(db)
    .find({ status: "in_progress", shareOfferSubmitPlan: { $exists: false } })
    .limit(limit - results.length)
    .toArray();
  for (const receipt of planless) {
    if (typeof receipt._id !== "string") continue;
    if (
      typeof receipt.fingerprint !== "string" ||
      !receipt.fingerprint.startsWith(SHARE_OFFER_SUBMIT_FINGERPRINT_DOMAIN)
    ) {
      continue;
    }
    await failMoneyFlowReceipt(receipts(db), receipt._id, "share-offer-submit:plan-never-stored");
    results.push({ submitKey: receipt._id, action: "settled-failed-no-plan" });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Accept flow
// ---------------------------------------------------------------------------

/** Immutable resume plan pinned before the first accept step. */
export interface ShareOfferAcceptPlan {
  version: 1;
  acceptKey: string;
  listingIdHex: string;
  offerIdHex: string;
  corpIdHex: string;
  sharesToAccept: number;
  sharesOffered: number;
  pricePerShare: number;
  turn: number;
  nowIso: string;
  forexEnabled: boolean;
  /** Buyer cap-table credit on the listing corp (reserved shares move here). */
  buyerCredit: ShareFillCapLeg;
  buyerIsCorp: boolean;
  buyerIdHex: string;
  buyerName: string;
  buyerCurrencyCode: string;
  /** Seller proceeds credit (anchor-unit proceeds converted to the seller field). */
  proceedsLeg: ShareFillCashLeg;
  sellerType: "character" | "corporation";
  sellerIdHex: string;
  sellerName: string;
  sellerCurrencyCode: string;
  /** Partial-accept escrow remainder. Null on a full accept (no step runs). */
  refundLeg: ShareFillCashLeg | null;
  /** Anchor-unit figures, exactly as the legacy response reported them. */
  proceeds: number;
  refund: number;
  listingCorpName: string;
  /** Stored at settle; replays return it verbatim. */
  response?: {
    sharesTransferred: number;
    proceeds: number;
    refundedToOffer: number;
    listingSharesRemaining: number;
  };
}

export function isShareOfferAcceptPlan(value: unknown): value is ShareOfferAcceptPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.version === 1 &&
    typeof plan.acceptKey === "string" &&
    typeof plan.offerIdHex === "string" &&
    typeof plan.listingIdHex === "string" &&
    typeof plan.buyerCredit === "object" &&
    plan.buyerCredit !== null &&
    typeof plan.proceedsLeg === "object" &&
    plan.proceedsLeg !== null
  );
}

/** Fingerprint covers the offer, size, price, and every pinned money leg. */
export function buildShareOfferAcceptFingerprint(plan: ShareOfferAcceptPlan): string {
  const cents = (n: number): string => String(Math.round(n * 100) / 100);
  const cash = (leg: ShareFillCashLeg | null): string =>
    leg ? `${leg.collection}:${leg.idHex}:${leg.field}:${cents(leg.amount)}` : "none";
  const cap = plan.buyerCredit;
  return [
    SHARE_OFFER_ACCEPT_FINGERPRINT_DOMAIN,
    plan.listingIdHex,
    plan.offerIdHex,
    `take:${plan.sharesToAccept}`,
    `price:${cents(plan.pricePerShare)}`,
    `buyer:${cap.field}:${cap.idHex}`,
    `proceeds:${cash(plan.proceedsLeg)}`,
    `refund:${cash(plan.refundLeg)}`,
  ].join(":");
}

export interface ShareOfferAcceptBody {
  sharesTransferred: number;
  proceeds: number;
  refundedToOffer: number;
  listingSharesRemaining: number;
}

export type ShareOfferAcceptFlowResult =
  | { ok: true; body: ShareOfferAcceptBody; replayed: boolean }
  | { ok: false; error: string; status: number };

type ShareOfferAcceptReceipt = MoneyFlowReceipt & {
  shareOfferAcceptPlan?: unknown;
  shareOfferAcceptResponse?: unknown;
};

function receiptsAcceptEx(db: Db): Collection<ShareOfferAcceptReceipt> {
  return db.collection<ShareOfferAcceptReceipt>(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION);
}

/**
 * CAS offer claim: `pending` to `accepted` with the flow key stamped. A
 * competing accept/withdraw/cancel/expire wins outright and this attempt
 * reports the legacy 409. The revert is conditional on this attempt owning
 * the claim, so compensating a later failure never reopens an offer another
 * flow resolved.
 */
function makeAcceptOfferClaimStep(db: Db, plan: ShareOfferAcceptPlan): MoneyFlowStep {
  const offers = db.collection<StampedAccount>("shareOffers");
  const offerId = new ObjectId(plan.offerIdHex);
  const now = new Date(plan.nowIso);
  const claimSub = deriveMoneyFlowKey(plan.acceptKey, "offer-claim");
  return {
    name: "offer-claim",
    apply: () =>
      applyKeyedUpdate(
        claimSub,
        {
          collection: offers,
          filter: { _id: offerId, status: "pending" } as Filter<StampedAccount>,
          update: {
            $set: {
              status: "accepted",
              lastShareOfferAcceptKey: plan.acceptKey,
              updatedAt: now,
            },
          },
        },
        {}
      ),
    revert: () =>
      applyKeyedUpdate(
        deriveMoneyFlowKey(claimSub, "compensate", "offer-claim"),
        {
          collection: offers,
          filter: {
            _id: offerId,
            status: "accepted",
            lastShareOfferAcceptKey: plan.acceptKey,
          } as Filter<StampedAccount>,
          update: { $set: { status: "pending", updatedAt: now } },
        },
        {}
      ),
  };
}

/**
 * CAS listing decrement: `open` + `sharesRemaining $gte` with the flow key
 * stamped, then the conditional `filled` flip. Both are naturally
 * idempotent (the stamp trips the `$ne: key` guard on replay; the flip
 * matches only an unstamped open zero-remaining row). The revert restores
 * `open` and the taken shares only while this attempt owns the stamp, and
 * only from `open`/`filled` — a cancel that claimed the listing meanwhile
 * keeps it.
 */
function makeAcceptListingClaimStep(db: Db, plan: ShareOfferAcceptPlan): MoneyFlowStep {
  const listings = db.collection<StampedAccount>("shareListings");
  const listingId = new ObjectId(plan.listingIdHex);
  const now = new Date(plan.nowIso);
  const claimSub = deriveMoneyFlowKey(plan.acceptKey, "listing-claim");
  return {
    name: "listing-claim",
    apply: async () => {
      const outcome = await applyKeyedUpdate(
        claimSub,
        {
          collection: listings,
          filter: {
            _id: listingId,
            status: "open",
            sharesRemaining: { $gte: plan.sharesToAccept },
          } as Filter<StampedAccount>,
          update: {
            $inc: { sharesRemaining: -plan.sharesToAccept },
            $set: { lastShareOfferAcceptKey: plan.acceptKey, updatedAt: now },
          },
        },
        {}
      );
      if (outcome !== "applied" && outcome !== "already-applied") return outcome;
      await listings.updateOne(
        {
          _id: listingId,
          status: "open",
          sharesRemaining: 0,
          lastShareOfferAcceptKey: plan.acceptKey,
        } as Filter<StampedAccount>,
        { $set: { status: "filled", updatedAt: now } }
      );
      return outcome;
    },
    revert: () =>
      applyKeyedUpdate(
        deriveMoneyFlowKey(claimSub, "compensate", "listing-claim"),
        {
          collection: listings,
          filter: {
            _id: listingId,
            status: { $in: ["open", "filled"] },
            lastShareOfferAcceptKey: plan.acceptKey,
          } as Filter<StampedAccount>,
          update: {
            $inc: { sharesRemaining: plan.sharesToAccept },
            $set: { status: "open", updatedAt: now },
          },
        },
        {}
      ),
  };
}

/** Step build shared by first attempt and crash recovery (from the stored plan). */
export function buildShareOfferAcceptSteps(db: Db, plan: ShareOfferAcceptPlan): MoneyFlowStep[] {
  const now = new Date(plan.nowIso);
  const corpId = new ObjectId(plan.corpIdHex);
  const steps: MoneyFlowStep[] = [
    makeAcceptOfferClaimStep(db, plan),
    makeAcceptListingClaimStep(db, plan),
    makeCapCreditStep(
      db,
      "buyer-cap-credit",
      deriveMoneyFlowKey(plan.acceptKey, "buyer-cap-credit"),
      corpId,
      plan.buyerCredit,
      plan.sharesToAccept,
      now
    ),
  ];
  // Zero-amount credits (a zero-price accept) move nothing: `$inc` by zero
  // is a no-op, so dropping the step changes no balance, mirroring the
  // legacy unguarded credits.
  if (plan.proceedsLeg.amount !== 0) {
    steps.push(
      makeCashStep(
        db,
        "seller-proceeds",
        deriveMoneyFlowKey(plan.acceptKey, "seller-proceeds"),
        plan.proceedsLeg,
        false,
        now
      )
    );
  }
  if (plan.refundLeg && plan.refundLeg.amount !== 0) {
    steps.push(
      makeCashStep(
        db,
        "buyer-refund",
        deriveMoneyFlowKey(plan.acceptKey, "buyer-refund"),
        plan.refundLeg,
        false,
        now
      )
    );
  }
  return steps;
}

function mapAcceptError(plan: ShareOfferAcceptPlan) {
  return (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error => {
    if (step.name === "offer-claim") {
      return new Error(
        "SHARE_OFFER_ACCEPT:409:Offer changed before this acceptance could be applied"
      );
    }
    if (step.name === "listing-claim") {
      // Disambiguated from a fresh listing read in the execute catch, so
      // the 404/400/400-concurrent legacy messages survive the migration.
      return new Error("SHARE_OFFER_ACCEPT:LISTING_RACE");
    }
    if (step.name === "buyer-cap-credit" && outcome === "missing") {
      return new Error(
        plan.buyerIsCorp ? "Buyer corporation not found" : "Buyer character not found"
      );
    }
    if (step.name === "seller-proceeds" && outcome === "missing") {
      return new Error(
        plan.sellerType === "corporation"
          ? "Seller corporation not found"
          : "Seller character not found"
      );
    }
    if (step.name === "buyer-refund" && outcome === "missing") {
      return new Error(
        plan.buyerIsCorp ? "Buyer corporation not found" : "Buyer character not found"
      );
    }
    return new Error(`share-offer-accept:${step.name}:${outcome}`);
  };
}

function acceptErrorOf(error: Error): { error: string; status: number } {
  const match = /^SHARE_OFFER_ACCEPT:(\d+):([\s\S]*)$/.exec(error.message);
  if (match) return { error: match[2]!, status: Number(match[1]) };
  throw error;
}

/**
 * Post-commit best-effort sell/refund tx rows with deterministic ids
 * (replays converge instead of duplicating them).
 */
async function emitAcceptTxBestEffort(db: Db, plan: ShareOfferAcceptPlan): Promise<void> {
  const now = new Date(plan.nowIso);
  const baseMeta = {
    listingId: plan.listingIdHex,
    offerId: plan.offerIdHex,
    corporationId: plan.corpIdHex,
    shares: plan.sharesToAccept,
    pricePerShare: plan.pricePerShare,
  };
  try {
    await emitTx(
      db,
      {
        type: "stock_trade_sell",
        turn: plan.turn,
        createdAt: now,
        subjectType: plan.sellerType,
        subjectId: new ObjectId(plan.sellerIdHex),
        subjectName: plan.sellerName,
        amount: Math.round(plan.proceedsLeg.amount * 100) / 100,
        currencyCode: plan.sellerCurrencyCode as CurrencyCode,
        counterpartyType: plan.buyerIsCorp ? "corporation" : "character",
        counterpartyId: new ObjectId(plan.buyerIdHex),
        counterpartyName: plan.buyerIsCorp ? "Buyer corporation" : "Buyer",
        meta: baseMeta,
      },
      undefined,
      { _id: keyedInsertId(plan.acceptKey, `${SHARE_OFFER_ACCEPT_TX_DOMAIN}:sell`) }
    );
  } catch {
    // Best effort, like every other migrated flow's audit row.
  }
  if (plan.refundLeg) {
    try {
      await emitTx(
        db,
        {
          type: "share_listing_refund",
          turn: plan.turn,
          createdAt: now,
          subjectType: plan.buyerIsCorp ? "corporation" : "character",
          subjectId: new ObjectId(plan.buyerIdHex),
          subjectName: plan.buyerName,
          amount: Math.round(plan.refundLeg.amount * 100) / 100,
          currencyCode: plan.buyerCurrencyCode as CurrencyCode,
          counterpartyType: "system",
          counterpartyName: "Private listing escrow",
          meta: {
            ...baseMeta,
            sharesRefunded: plan.sharesOffered - plan.sharesToAccept,
          },
        },
        undefined,
        { _id: keyedInsertId(plan.acceptKey, `${SHARE_OFFER_ACCEPT_TX_DOMAIN}:refund`) }
      );
    } catch {
      // Best effort.
    }
  }
}

/**
 * Settle the response from live post-flow state (the listing's current
 * remainder, which concurrent accepts may have moved past the pinned
 * figure) and store it for replays.
 */
async function settleAcceptResponse(
  db: Db,
  plan: ShareOfferAcceptPlan
): Promise<ShareOfferAcceptBody> {
  const live = await db
    .collection<ShareListing>("shareListings")
    .findOne({ _id: new ObjectId(plan.listingIdHex) });
  const body: ShareOfferAcceptBody = {
    sharesTransferred: plan.sharesToAccept,
    proceeds: plan.proceeds,
    refundedToOffer: plan.refund,
    listingSharesRemaining: live?.sharesRemaining ?? 0,
  };
  try {
    await receiptsAcceptEx(db).updateOne(
      { _id: plan.acceptKey },
      {
        $set: {
          "shareOfferAcceptPlan.response": body,
          shareOfferAcceptResponse: body,
          updatedAt: new Date(),
        },
      }
    );
  } catch {
    // Response store is best effort; the receipt already settled `completed`.
  }
  return body;
}

async function runStoredAcceptPlan(
  db: Db,
  acceptKey: string,
  plan: ShareOfferAcceptPlan
): Promise<ShareOfferAcceptFlowResult> {
  try {
    await runMoneyFlowSteps(
      receipts(db),
      acceptKey,
      buildShareOfferAcceptSteps(db, plan),
      mapAcceptError(plan)
    );
  } catch (error) {
    if (error instanceof Error && error.message === "SHARE_OFFER_ACCEPT:LISTING_RACE") {
      return disambiguateListingRace(db, plan);
    }
    if (error instanceof Error && error.message.startsWith("SHARE_OFFER_ACCEPT:")) {
      const mapped = acceptErrorOf(error);
      return { ok: false, error: mapped.error, status: mapped.status };
    }
    return { ok: false, error: "Failed to accept offer", status: 500 };
  }
  const body = await settleAcceptResponse(db, plan);
  await emitAcceptTxBestEffort(db, plan);
  return { ok: true, body, replayed: true };
}

/**
 * Legacy listing-race disambiguation from a fresh read: the listing is
 * gone (404), no longer open (400), or a concurrent acceptance took the
 * shares (400). Runs only on the claim-failure path.
 */
async function disambiguateListingRace(
  db: Db,
  plan: ShareOfferAcceptPlan
): Promise<ShareOfferAcceptFlowResult> {
  const fresh = await db
    .collection<ShareListing>("shareListings")
    .findOne({ _id: new ObjectId(plan.listingIdHex) });
  if (!fresh) {
    return { ok: false, error: "Listing not found", status: 404 };
  }
  if (fresh.status !== "open") {
    return { ok: false, error: "Listing is no longer open", status: 400 };
  }
  return {
    ok: false,
    error: "Not enough shares remaining (concurrent acceptance detected)",
    status: 400,
  };
}

/**
 * Execute one offer acceptance to exactly one terminal state. The plan is
 * already fully pinned by the caller; this claims the receipt, stores the
 * plan, runs the steps, and returns the legacy outcome body. Throws
 * MoneyFlowKeyConflictError / MoneyFlowTerminalError from the claim for the
 * route to map to 409.
 */
export async function executeShareOfferAcceptFlow(
  db: Db,
  plan: ShareOfferAcceptPlan,
  opts: { idempotencyKey?: string } = {}
): Promise<ShareOfferAcceptFlowResult> {
  const acceptKey = opts.idempotencyKey ?? randomUUID();
  if (acceptKey !== plan.acceptKey) {
    throw new Error("share-offer-accept:key-mismatch");
  }
  const fingerprint = buildShareOfferAcceptFingerprint(plan);
  const claim = await claimMoneyFlowReceipt(receipts(db), acceptKey, fingerprint);
  if (claim === "duplicate") {
    const stored = await receiptsAcceptEx(db).findOne({ _id: acceptKey });
    if (stored?.shareOfferAcceptResponse && typeof stored.shareOfferAcceptResponse === "object") {
      return {
        ok: true,
        body: stored.shareOfferAcceptResponse as ShareOfferAcceptBody,
        replayed: true,
      };
    }
    const storedPlan = stored?.shareOfferAcceptPlan;
    if (isShareOfferAcceptPlan(storedPlan) && storedPlan.response) {
      return { ok: true, body: storedPlan.response, replayed: true };
    }
    return recoverShareOfferAcceptByKey(db, acceptKey);
  }
  if (claim === "in-progress") {
    return recoverShareOfferAcceptByKey(db, acceptKey);
  }

  try {
    await receiptsAcceptEx(db).updateOne(
      { _id: acceptKey },
      { $set: { shareOfferAcceptPlan: { ...plan }, updatedAt: new Date() } }
    );
  } catch (planError) {
    await failMoneyFlowReceipt(receipts(db), acceptKey, "share-offer-accept:plan-store");
    throw planError;
  }

  try {
    await runMoneyFlowSteps(
      receipts(db),
      acceptKey,
      buildShareOfferAcceptSteps(db, plan),
      mapAcceptError(plan)
    );
  } catch (error) {
    if (error instanceof Error && error.message === "SHARE_OFFER_ACCEPT:LISTING_RACE") {
      return disambiguateListingRace(db, plan);
    }
    if (error instanceof Error && error.message.startsWith("SHARE_OFFER_ACCEPT:")) {
      const mapped = acceptErrorOf(error);
      return { ok: false, error: mapped.error, status: mapped.status };
    }
    throw error;
  }
  const body = await settleAcceptResponse(db, plan);
  await emitAcceptTxBestEffort(db, plan);
  return { ok: true, body, replayed: false };
}

/**
 * Route-facing key lookup: when the client passed an explicit
 * `Idempotency-Key` with a receipt already on file, the first attempt
 * already validated, so the retry reconciles through the keyed steps
 * instead of re-running the route guards. Returns null when no receipt
 * exists and the route must validate fresh.
 */
export async function getStoredShareOfferAcceptResponse(
  db: Db,
  acceptKey: string
): Promise<{ settled: boolean } | null> {
  const receipt = await receiptsAcceptEx(db).findOne({ _id: acceptKey });
  if (!receipt) return null;
  return { settled: receipt.status !== "in_progress" };
}

/**
 * Crash recovery for one accept receipt, from only the flow key: replays
 * the stored plan to convergence. A plan-less receipt settled here as
 * `failed` is truthful because the plan store precedes the first step, so
 * a missing plan means no step ever ran and nothing moved.
 */
export async function recoverShareOfferAcceptReceipt(
  db: Db,
  acceptKey: string
): Promise<ShareOfferAcceptRecoveryResult> {
  const receipt = await receiptsAcceptEx(db).findOne({ _id: acceptKey });
  if (!receipt) return { acceptKey, action: "skipped-missing" };
  if (receipt.status !== "in_progress") return { acceptKey, action: "skipped-settled" };
  const stored = receipt.shareOfferAcceptPlan;
  if (!isShareOfferAcceptPlan(stored)) {
    await failMoneyFlowReceipt(receipts(db), acceptKey, "share-offer-accept:plan-never-stored");
    return { acceptKey, action: "settled-failed-no-plan" };
  }
  const result = await runStoredAcceptPlan(db, acceptKey, stored);
  return {
    acceptKey,
    action: result.ok ? "accept-recovered" : "accept-incomplete",
  };
}

/**
 * Route- and caller-facing recovery: maps the receipt action onto the
 * legacy accept surface. Same-key retries converge here instead of
 * double-paying the seller or double-refunding the buyer.
 */
export async function recoverShareOfferAcceptByKey(
  db: Db,
  acceptKey: string
): Promise<ShareOfferAcceptFlowResult> {
  const receipt = await receiptsAcceptEx(db).findOne({ _id: acceptKey });
  if (!receipt) return { ok: false, error: "Offer is not pending", status: 400 };
  if (receipt.status === "completed") {
    if (receipt.shareOfferAcceptResponse && typeof receipt.shareOfferAcceptResponse === "object") {
      return {
        ok: true,
        body: receipt.shareOfferAcceptResponse as ShareOfferAcceptBody,
        replayed: true,
      };
    }
    const stored = receipt.shareOfferAcceptPlan;
    if (isShareOfferAcceptPlan(stored) && stored.response) {
      return { ok: true, body: stored.response, replayed: true };
    }
    if (isShareOfferAcceptPlan(stored)) {
      // Crash between the `completed` settle and the response store: the
      // money already moved exactly once, so rebuild the response from live
      // state instead of failing the replay.
      const rebuilt = await settleAcceptResponse(db, stored);
      return { ok: true, body: rebuilt, replayed: true };
    }
    return {
      ok: false,
      error: "Offer changed before this acceptance could be applied",
      status: 409,
    };
  }
  if (receipt.status !== "in_progress") {
    throw new MoneyFlowTerminalError(acceptKey, receipt.status, receipt.error);
  }
  const result = await recoverShareOfferAcceptReceipt(db, acceptKey);
  switch (result.action) {
    case "accept-recovered":
    case "skipped-settled": {
      const settled = await receiptsAcceptEx(db).findOne({ _id: acceptKey });
      if (
        settled?.shareOfferAcceptResponse &&
        typeof settled.shareOfferAcceptResponse === "object"
      ) {
        return {
          ok: true,
          body: settled.shareOfferAcceptResponse as ShareOfferAcceptBody,
          replayed: true,
        };
      }
      const stored = settled?.shareOfferAcceptPlan;
      if (isShareOfferAcceptPlan(stored) && stored.response) {
        return { ok: true, body: stored.response, replayed: true };
      }
      return { ok: false, error: "Failed to accept offer", status: 500 };
    }
    case "settled-failed-no-plan":
      return { ok: false, error: "Acceptance did not complete; retry with a new key", status: 400 };
    case "skipped-missing":
      return { ok: false, error: "Offer is not pending", status: 400 };
    case "accept-incomplete": {
      const current = await receiptsAcceptEx(db).findOne({ _id: acceptKey });
      return { ok: false, error: current?.error ?? "Failed to accept offer", status: 500 };
    }
  }
}

export type ShareOfferAcceptRecoveryAction =
  | "accept-recovered"
  | "accept-incomplete"
  | "settled-failed-no-plan"
  | "skipped-settled"
  | "skipped-missing";

export interface ShareOfferAcceptRecoveryResult {
  acceptKey: string;
  action: ShareOfferAcceptRecoveryAction;
}

/**
 * Bounded accept orphan scan for the periodic driver. Recovers every
 * `in_progress` accept receipt from its stored plan; plan-less receipts
 * settle `failed` (the plan store precedes the first step, so nothing
 * moved). Foreign-domain receipts stay out via the fingerprint prefix.
 */
export async function recoverShareOfferAcceptOrphans(
  db: Db,
  limit = 50
): Promise<ShareOfferAcceptRecoveryResult[]> {
  const stuck = await receiptsAcceptEx(db)
    .find({ status: "in_progress", shareOfferAcceptPlan: { $exists: true } })
    .limit(limit)
    .toArray();
  const results: ShareOfferAcceptRecoveryResult[] = [];
  for (const receipt of stuck) {
    const stored = receipt.shareOfferAcceptPlan;
    if (!isShareOfferAcceptPlan(stored)) {
      await failMoneyFlowReceipt(receipts(db), receipt._id, "share-offer-accept:plan-never-stored");
      results.push({ acceptKey: receipt._id, action: "settled-failed-no-plan" });
      continue;
    }
    const result = await runStoredAcceptPlan(db, receipt._id, stored);
    results.push({
      acceptKey: receipt._id,
      action: result.ok ? "accept-recovered" : "accept-incomplete",
    });
  }
  if (results.length >= limit) return results;
  const planless = await receiptsAcceptEx(db)
    .find({ status: "in_progress", shareOfferAcceptPlan: { $exists: false } })
    .limit(limit - results.length)
    .toArray();
  for (const receipt of planless) {
    if (typeof receipt._id !== "string") continue;
    if (
      typeof receipt.fingerprint !== "string" ||
      !receipt.fingerprint.startsWith(SHARE_OFFER_ACCEPT_FINGERPRINT_DOMAIN)
    ) {
      continue;
    }
    await failMoneyFlowReceipt(receipts(db), receipt._id, "share-offer-accept:plan-never-stored");
    results.push({ acceptKey: receipt._id, action: "settled-failed-no-plan" });
  }
  return results;
}
