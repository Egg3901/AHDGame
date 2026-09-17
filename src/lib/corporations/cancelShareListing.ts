import { randomUUID } from "node:crypto";
import { ObjectId, type Collection, type Db, type Filter } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { Character, Corporation, ShareListing, ShareOffer } from "@/lib/db/types";
import {
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  deriveMoneyFlowKey,
  failMoneyFlowReceipt,
  keyedInsertId,
  MoneyFlowKeyConflictError,
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
  personalBalanceField,
  type ShareFillCapLeg,
  type ShareFillCashLeg,
} from "@/lib/corporations/commands/shareTrading/shareFillMoney";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { emitTx } from "@/lib/financialTxLog/emit";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

export interface CancelListingResult {
  ok: true;
  refundedOffers: number;
  sharesReturned: number;
}

export interface CancelListingError {
  ok: false;
  /** Set when forex is enabled but a needed buyer-home-currency rate is missing. */
  rateUnavailable?: boolean;
  error: string;
}

/**
 * Keyed listing-cancel settlement (issue #1672).
 *
 * Cancelling an open share listing claimed the listing, flipped each pending
 * offer, refunded buyer escrows, and restored reserved shares with plain
 * updates and manual rollback arrays: a crash between the listing claim and
 * the first refund left the listing cancelled with escrows kept (no receipt
 * existed, so no retry could converge it), a crash mid-refund double-refunded
 * on manual retry, and a crash between the last refund and the share restore
 * stranded the seller's shares. Concurrent cancels could both pass the
 * status check and refund twice.
 *
 * This module runs every cancel as one keyed money flow, following the
 * share-order-refund conventions:
 *
 * - One receipt per cancel attempt. Internal callers (market cleanup,
 *   currency conversion) mint one per call; the DELETE route forwards the
 *   client `Idempotency-Key` (minted when absent). Same-key retries converge
 *   on the stored plan and return the stored outcome; a key reused with a
 *   different fingerprint throws `MoneyFlowKeyConflictError` (fail closed);
 *   a key that settled without completing throws `MoneyFlowTerminalError`.
 * - The route-facing helper pins every refund amount, currency field, party,
 *   and the seller-restore basis BEFORE the flow starts, and the flow stores
 *   that immutable plan on the receipt before the first step. Recovery
 *   replays the stored figures instead of re-reading post-cancel state, so
 *   FX drift between attempt and retry cannot move money. Buyer-existence
 *   and FX prerequisites are validated before any write (the legacy code
 *   claimed the listing first and restored it on failure; the end state is
 *   identical with none of the intermediate flapping).
 * - The listing claim (`open` to `cancelled`, stamped with the flow key) is
 *   the first step: a competing cancel or accept wins outright and this
 *   attempt reports the legacy `Listing is not open`. Each offer cancels
 *   through a claim step plus a keyed refund-credit step; an offer that
 *   resolved elsewhere (accepted/filled) between pin and claim converges as
 *   a skip, matching the legacy `continue`. The seller restore reuses the
 *   keyed cap-credit step. `runMoneyFlowSteps` reverses the applied prefix
 *   with keyed inverses before settling, so the flow ends `completed` or
 *   terminal without effect, never partial.
 * - The refund tx rows are post-commit best effort with deterministic `_id`s
 *   (replays converge instead of duplicating them). The legacy code awaited
 *   each tx row inside the loop and rolled the whole cancel back when one
 *   threw; tx emission no longer gates settlement, like every other migrated
 *   flow.
 *
 * Legacy economics and API behavior are preserved: identical refund math
 * (anchor-normalized escrow, same rounding, same tx shape), identical
 * orphan-buyer errors, identical error strings (including the 503-eligible
 * FX message), and the refunded-offers count still reports only offers this
 * cancel actually flipped.
 */

export const SHARE_LISTING_CANCEL_FINGERPRINT_DOMAIN = "share-listing-cancel";
export const SHARE_LISTING_CANCEL_TX_DOMAIN = "share-listing-cancel-tx";

export interface ShareListingCancelOfferRefund {
  offerIdHex: string;
  subjectType: "character" | "corporation";
  subjectIdHex: string;
  subjectName: string;
  currencyCode: string;
  refundLeg: ShareFillCashLeg;
  shares: number;
  pricePerShare: number;
  /** Legacy surface when the buyer document is gone at step time. */
  missingError: "Buyer corporation not found" | "Buyer character not found";
  txMeta: { shares: number; pricePerShare: number };
}

/**
 * Immutable resume plan pinned before the first step. Every refund amount,
 * currency field, party, and the seller-restore basis is fixed here;
 * recovery replays these figures instead of re-reading post-cancel state.
 */
export interface ShareListingCancelPlan {
  version: 1;
  cancelKey: string;
  listingIdHex: string;
  corpIdHex: string;
  turn: number;
  nowIso: string;
  forexEnabled: boolean;
  sharesRemaining: number;
  /** Seller share restore. Null when nothing remains to restore. */
  restoreLeg: ShareFillCapLeg | null;
  returnPrice: number;
  refunds: ShareListingCancelOfferRefund[];
  /** Stored at settle; replays return it verbatim. */
  response?: { refundedOffers: number; sharesReturned: number };
}

export function isShareListingCancelPlan(value: unknown): value is ShareListingCancelPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.version === 1 &&
    typeof plan.cancelKey === "string" &&
    typeof plan.listingIdHex === "string" &&
    typeof plan.corpIdHex === "string" &&
    Array.isArray(plan.refunds) &&
    typeof plan.sharesRemaining === "number"
  );
}

/** Fingerprint covers the listing, seller restore, and every pinned refund. */
export function buildShareListingCancelFingerprint(plan: ShareListingCancelPlan): string {
  const cents = (n: number): string => String(Math.round(n * 100) / 100);
  const refunds = plan.refunds
    .map(
      (refund) =>
        `${refund.offerIdHex}:${refund.subjectType}:${refund.subjectIdHex}:${cents(refund.refundLeg.amount)}`
    )
    .join(",");
  const restore = plan.restoreLeg
    ? `${plan.restoreLeg.field}:${plan.restoreLeg.idHex}:${plan.sharesRemaining}`
    : "none";
  return [
    SHARE_LISTING_CANCEL_FINGERPRINT_DOMAIN,
    plan.listingIdHex,
    plan.corpIdHex,
    `restore:${restore}`,
    `refunds:${refunds}`,
  ].join(":");
}

export type ShareListingCancelFlowResult =
  | { ok: true; body: { refundedOffers: number; sharesReturned: number }; replayed: boolean }
  | { ok: false; error: string; rateUnavailable?: boolean };

type ShareListingCancelReceipt = MoneyFlowReceipt & {
  shareListingCancelPlan?: unknown;
  shareListingCancelResponse?: unknown;
};

function receipts(db: Db): Collection<MoneyFlowReceipt> {
  return db.collection<MoneyFlowReceipt>(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION);
}

function receiptsEx(db: Db): Collection<ShareListingCancelReceipt> {
  return db.collection<ShareListingCancelReceipt>(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION);
}

interface ListingAccount {
  _id: ObjectId;
  appliedMoneyFlowKeys?: string[];
}

/**
 * CAS listing claim: `open` to `cancelled` with the flow key stamped. The
 * filter pins `open`, so a competing cancel wins outright and this attempt
 * reports the legacy `Listing is not open`. The revert restores `open`.
 */
function makeListingClaimStep(
  db: Db,
  cancelKey: string,
  listingId: ObjectId,
  now: Date
): MoneyFlowStep {
  const listings = db.collection<ListingAccount>("shareListings");
  return {
    name: "listing-claim",
    apply: () =>
      applyKeyedUpdate(
        deriveMoneyFlowKey(cancelKey, "listing-claim"),
        {
          collection: listings,
          filter: { _id: listingId, status: "open" } as Filter<ListingAccount>,
          update: {
            $set: { status: "cancelled", lastShareListingCancelKey: cancelKey, updatedAt: now },
          },
        },
        {}
      ),
    revert: () =>
      applyKeyedUpdate(
        deriveMoneyFlowKey(cancelKey, "compensate", "listing-claim"),
        {
          collection: listings,
          filter: {
            _id: listingId,
            status: "cancelled",
            lastShareListingCancelKey: cancelKey,
          } as Filter<ListingAccount>,
          update: { $set: { status: "open", updatedAt: now } },
        },
        {}
      ),
  };
}

interface OfferAccount {
  _id: ObjectId;
  appliedMoneyFlowKeys?: string[];
}

/**
 * CAS offer claim: `pending` to `cancelled` with the flow key stamped. An
 * offer that resolved elsewhere between plan pin and claim (accepted,
 * filled, or taken by a competing cancel) reports `already-applied` so the
 * cancel converges as a skip, matching the legacy `continue` on a lost
 * claim race. The revert is conditional on this attempt owning the claim:
 * a skip records no key, so a later compensation must not reopen an offer
 * another flow resolved.
 */
function makeOfferClaimStep(
  db: Db,
  cancelKey: string,
  refund: ShareListingCancelOfferRefund,
  now: Date
): MoneyFlowStep {
  const offers = db.collection<OfferAccount>("shareOffers");
  const offerId = new ObjectId(refund.offerIdHex);
  const claimSub = deriveMoneyFlowKey(cancelKey, "offer-claim", refund.offerIdHex);
  return {
    name: `offer-claim:${refund.offerIdHex}`,
    apply: async () => {
      const outcome = await applyKeyedUpdate(
        claimSub,
        {
          collection: offers,
          filter: { _id: offerId, status: "pending" } as Filter<OfferAccount>,
          update: {
            $set: {
              status: "cancelled",
              lastShareListingCancelKey: cancelKey,
              updatedAt: now,
            },
          },
        },
        {}
      );
      if (outcome === "applied" || outcome === "already-applied") return outcome;
      // Missing or resolved elsewhere: converge as a skip (legacy `continue`).
      return "already-applied" as MoneyFlowLegOutcome;
    },
    revert: async () => {
      const live = await offers.findOne({ _id: offerId } as Filter<OfferAccount>, {
        projection: { appliedMoneyFlowKeys: 1, status: 1, lastShareListingCancelKey: 1 },
      });
      const owns =
        (
          live as unknown as { appliedMoneyFlowKeys?: string[] } | null
        )?.appliedMoneyFlowKeys?.includes(claimSub) === true;
      if (!owns) return "already-applied" as MoneyFlowLegOutcome;
      return applyKeyedUpdate(
        deriveMoneyFlowKey(claimSub, "compensate", "offer-claim"),
        {
          collection: offers,
          filter: {
            _id: offerId,
            status: "cancelled",
            lastShareListingCancelKey: cancelKey,
          } as Filter<OfferAccount>,
          update: { $set: { status: "pending", updatedAt: now } },
        },
        {}
      );
    },
  };
}

/** Keyed escrow refund credit for one claimed offer (unguarded, exactly once). */
function makeOfferRefundStep(
  db: Db,
  cancelKey: string,
  refund: ShareListingCancelOfferRefund,
  now: Date
): MoneyFlowStep {
  return makeCashStep(
    db,
    `offer-refund:${refund.offerIdHex}`,
    deriveMoneyFlowKey(cancelKey, "offer-refund", refund.offerIdHex),
    refund.refundLeg,
    false,
    now
  );
}

function mapCancelError(plan: ShareListingCancelPlan) {
  return (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error => {
    if (step.name === "listing-claim") {
      return new Error("SHARE_LISTING_CANCEL:400:Listing is not open");
    }
    if (step.name.startsWith("offer-claim:")) {
      // Unreachable: the claim converges skips instead of failing. A throw
      // here means the read itself failed.
      return new Error(`SHARE_LISTING_CANCEL:500:Failed to cancel listing:${outcome}`);
    }
    if (step.name.startsWith("offer-refund:")) {
      const refund = plan.refunds.find((entry) => step.name === `offer-refund:${entry.offerIdHex}`);
      const message = refund?.missingError ?? "Buyer character not found";
      return new Error(`SHARE_LISTING_CANCEL:400:${message}`);
    }
    if (step.name === "restore-credit") {
      return new Error("SHARE_LISTING_CANCEL:500:Failed to restore seller shares");
    }
    return new Error(`share-listing-cancel:${step.name}:${outcome}`);
  };
}

function cancelErrorOf(error: Error): { error: string; status: number } {
  const match = /^SHARE_LISTING_CANCEL:(\d+):([\s\S]*)$/.exec(error.message);
  if (match) return { error: match[2]!, status: Number(match[1]) };
  throw error;
}

/** Step build shared by first attempt and crash recovery (from the stored plan). */
export function buildShareListingCancelSteps(
  db: Db,
  plan: ShareListingCancelPlan
): MoneyFlowStep[] {
  const now = new Date(plan.nowIso);
  const corpId = new ObjectId(plan.corpIdHex);
  const listingId = new ObjectId(plan.listingIdHex);
  const steps: MoneyFlowStep[] = [makeListingClaimStep(db, plan.cancelKey, listingId, now)];
  for (const refund of plan.refunds) {
    steps.push(makeOfferClaimStep(db, plan.cancelKey, refund, now));
    steps.push(makeOfferRefundStep(db, plan.cancelKey, refund, now));
  }
  if (plan.restoreLeg && plan.sharesRemaining > 0) {
    steps.push(
      makeCapCreditStep(
        db,
        "restore-credit",
        deriveMoneyFlowKey(plan.cancelKey, "restore-credit"),
        corpId,
        plan.restoreLeg,
        plan.sharesRemaining,
        now
      )
    );
  }
  return steps;
}

/** Post-commit best-effort refund tx rows with deterministic ids (replays converge). */
async function emitCancelTxBestEffort(db: Db, plan: ShareListingCancelPlan): Promise<void> {
  for (const refund of plan.refunds) {
    try {
      await emitTx(
        db,
        {
          type: "share_listing_refund",
          turn: plan.turn,
          createdAt: new Date(plan.nowIso),
          subjectType: refund.subjectType,
          subjectId: new ObjectId(refund.subjectIdHex),
          subjectName: refund.subjectName,
          amount: Math.round(refund.refundLeg.amount * 100) / 100,
          currencyCode: refund.currencyCode as CurrencyCode,
          counterpartyType: "system",
          counterpartyName: "Private listing escrow",
          meta: {
            listingId: plan.listingIdHex,
            offerId: refund.offerIdHex,
            corporationId: plan.corpIdHex,
            shares: refund.shares,
            pricePerShare: refund.pricePerShare,
            reason: "listing_cancelled",
          },
        },
        undefined,
        {
          _id: keyedInsertId(
            plan.cancelKey,
            `${SHARE_LISTING_CANCEL_TX_DOMAIN}:${refund.offerIdHex}`
          ),
        }
      );
    } catch {
      // Best effort, like the legacy fire-and-forget rows.
    }
  }
}

/**
 * Execute one listing cancel to exactly one terminal state. The plan is
 * already fully pinned by the caller; this claims the receipt, stores the
 * plan, runs the steps, counts the flipped offers, and returns the legacy
 * outcome body. Throws MoneyFlowKeyConflictError / MoneyFlowTerminalError
 * from the claim for the route to map to 409.
 */
export async function executeShareListingCancelFlow(
  db: Db,
  plan: ShareListingCancelPlan,
  opts: { idempotencyKey?: string } = {}
): Promise<ShareListingCancelFlowResult> {
  const cancelKey = opts.idempotencyKey ?? randomUUID();
  if (cancelKey !== plan.cancelKey) {
    throw new Error("share-listing-cancel:key-mismatch");
  }
  const fingerprint = buildShareListingCancelFingerprint(plan);
  const claim = await claimMoneyFlowReceipt(receipts(db), cancelKey, fingerprint);
  if (claim === "duplicate") {
    const stored = await receiptsEx(db).findOne({ _id: cancelKey });
    if (
      stored?.shareListingCancelResponse &&
      typeof stored.shareListingCancelResponse === "object"
    ) {
      return {
        ok: true,
        body: stored.shareListingCancelResponse as {
          refundedOffers: number;
          sharesReturned: number;
        },
        replayed: true,
      };
    }
    const storedPlan = stored?.shareListingCancelPlan;
    if (isShareListingCancelPlan(storedPlan) && storedPlan.response) {
      return { ok: true, body: storedPlan.response, replayed: true };
    }
    return {
      ok: true,
      body: {
        refundedOffers: plan.refunds.length,
        sharesReturned: plan.sharesRemaining,
      },
      replayed: true,
    };
  }
  if (claim === "in-progress") {
    return recoverShareListingCancelByKey(db, cancelKey);
  }

  try {
    await receiptsEx(db).updateOne(
      { _id: cancelKey },
      { $set: { shareListingCancelPlan: { ...plan }, updatedAt: new Date() } }
    );
  } catch (planError) {
    await failMoneyFlowReceipt(receipts(db), cancelKey, "share-listing-cancel:plan-store");
    throw planError;
  }

  try {
    await runMoneyFlowSteps(
      receipts(db),
      cancelKey,
      buildShareListingCancelSteps(db, plan),
      mapCancelError(plan)
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("SHARE_LISTING_CANCEL:")) {
      const mapped = cancelErrorOf(error);
      if (mapped.status === 400) {
        return { ok: false, error: mapped.error };
      }
      throw new Error(mapped.error);
    }
    throw error;
  }
  const body = await settleCancelResponse(db, plan);
  await runCancelPostCommit(db, plan);
  return { ok: true, body, replayed: false };
}

/**
 * Count the offers this cancel actually flipped (stamped with our key and
 * still cancelled) and store the outcome for replays. Skipped offers
 * (resolved elsewhere) carry no stamp, so they never inflate the count.
 */
async function settleCancelResponse(
  db: Db,
  plan: ShareListingCancelPlan
): Promise<{ refundedOffers: number; sharesReturned: number }> {
  const listingId = new ObjectId(plan.listingIdHex);
  const flipped = await db.collection<ShareOffer>("shareOffers").countDocuments({
    listingId,
    status: "cancelled",
    lastShareListingCancelKey: plan.cancelKey,
  });
  const body = { refundedOffers: flipped, sharesReturned: plan.sharesRemaining };
  try {
    await receiptsEx(db).updateOne(
      { _id: plan.cancelKey },
      {
        $set: {
          "shareListingCancelPlan.response": body,
          shareListingCancelResponse: body,
          updatedAt: new Date(),
        },
      }
    );
  } catch {
    // Response store is best effort; the receipt already settled `completed`.
  }
  return body;
}

async function runCancelPostCommit(db: Db, plan: ShareListingCancelPlan): Promise<void> {
  void emitCancelTxBestEffort(db, plan);
}

/**
 * Route-facing key lookup: when the client passed an explicit
 * `Idempotency-Key` with a receipt already on file, the retry reconciles
 * through the keyed steps instead of re-running the route guards. Returns
 * null when no receipt exists and the route must validate fresh.
 */
export async function getStoredShareListingCancelResponse(
  db: Db,
  cancelKey: string
): Promise<{ settled: boolean } | null> {
  const receipt = await receiptsEx(db).findOne({ _id: cancelKey });
  if (!receipt) return null;
  return { settled: receipt.status !== "in_progress" };
}

async function runStoredCancelPlan(
  db: Db,
  cancelKey: string,
  plan: ShareListingCancelPlan
): Promise<ShareListingCancelFlowResult> {
  try {
    await runMoneyFlowSteps(
      receipts(db),
      cancelKey,
      buildShareListingCancelSteps(db, plan),
      mapCancelError(plan)
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("SHARE_LISTING_CANCEL:")) {
      const mapped = cancelErrorOf(error);
      if (mapped.status === 400) {
        return { ok: false, error: mapped.error };
      }
      return { ok: false, error: "Failed to cancel listing" };
    }
    return { ok: false, error: "Failed to cancel listing" };
  }
  const body = await settleCancelResponse(db, plan);
  await runCancelPostCommit(db, plan);
  return { ok: true, body, replayed: true };
}

/**
 * Crash recovery for one cancel receipt, from only the flow key: replays
 * the stored plan to convergence. A plan-less receipt settled here as
 * `failed` is truthful because the plan store precedes the first step, so
 * a missing plan means no step ever ran and nothing moved.
 */
export async function recoverShareListingCancelReceipt(
  db: Db,
  cancelKey: string
): Promise<ShareListingCancelRecoveryResult> {
  const receipt = await receiptsEx(db).findOne({ _id: cancelKey });
  if (!receipt) return { cancelKey, action: "skipped-missing" };
  if (receipt.status !== "in_progress") return { cancelKey, action: "skipped-settled" };
  const stored = receipt.shareListingCancelPlan;
  if (!isShareListingCancelPlan(stored)) {
    await failMoneyFlowReceipt(receipts(db), cancelKey, "share-listing-cancel:plan-never-stored");
    return { cancelKey, action: "settled-failed-no-plan" };
  }
  const result = await runStoredCancelPlan(db, cancelKey, stored);
  return {
    cancelKey,
    action: result.ok ? "cancel-recovered" : "cancel-incomplete",
  };
}

/**
 * Route- and caller-facing recovery: maps the receipt action onto the
 * legacy cancel surface. Same-key retries converge here instead of
 * double-refunding.
 */
export async function recoverShareListingCancelByKey(
  db: Db,
  cancelKey: string
): Promise<ShareListingCancelFlowResult> {
  const receipt = await receiptsEx(db).findOne({ _id: cancelKey });
  if (!receipt) return { ok: false, error: "Listing is not open" };
  if (receipt.status === "completed") {
    if (
      receipt.shareListingCancelResponse &&
      typeof receipt.shareListingCancelResponse === "object"
    ) {
      return {
        ok: true,
        body: receipt.shareListingCancelResponse as {
          refundedOffers: number;
          sharesReturned: number;
        },
        replayed: true,
      };
    }
    const stored = receipt.shareListingCancelPlan;
    if (isShareListingCancelPlan(stored) && stored.response) {
      return { ok: true, body: stored.response, replayed: true };
    }
    return { ok: false, error: "Listing is not open" };
  }
  if (receipt.status !== "in_progress") {
    throw new MoneyFlowTerminalError(cancelKey, receipt.status, receipt.error);
  }
  const result = await recoverShareListingCancelReceipt(db, cancelKey);
  switch (result.action) {
    case "cancel-recovered":
    case "skipped-settled": {
      const settled = await receiptsEx(db).findOne({ _id: cancelKey });
      if (
        settled?.shareListingCancelResponse &&
        typeof settled.shareListingCancelResponse === "object"
      ) {
        return {
          ok: true,
          body: settled.shareListingCancelResponse as {
            refundedOffers: number;
            sharesReturned: number;
          },
          replayed: true,
        };
      }
      const stored = settled?.shareListingCancelPlan;
      if (isShareListingCancelPlan(stored) && stored.response) {
        return { ok: true, body: stored.response, replayed: true };
      }
      return { ok: false, error: "Failed to cancel listing" };
    }
    case "settled-failed-no-plan":
      return { ok: false, error: "Cancel did not complete; retry with a new key" };
    case "skipped-missing":
      return { ok: false, error: "Listing is not open" };
    case "cancel-incomplete": {
      const current = await receiptsEx(db).findOne({ _id: cancelKey });
      return { ok: false, error: current?.error ?? "Failed to cancel listing" };
    }
  }
}

export type ShareListingCancelRecoveryAction =
  | "cancel-recovered"
  | "cancel-incomplete"
  | "settled-failed-no-plan"
  | "skipped-settled"
  | "skipped-missing";

export interface ShareListingCancelRecoveryResult {
  cancelKey: string;
  action: ShareListingCancelRecoveryAction;
}

/**
 * Bounded cancel orphan scan for the periodic driver. Recovers every
 * `in_progress` cancel receipt from its stored plan; plan-less receipts
 * settle `failed` (the plan store precedes the first step, so nothing
 * moved). Foreign-domain receipts stay out via the fingerprint prefix.
 */
export async function recoverShareListingCancelOrphans(
  db: Db,
  limit = 50
): Promise<ShareListingCancelRecoveryResult[]> {
  const stuck = await receiptsEx(db)
    .find({ status: "in_progress", shareListingCancelPlan: { $exists: true } })
    .limit(limit)
    .toArray();
  const results: ShareListingCancelRecoveryResult[] = [];
  for (const receipt of stuck) {
    const stored = receipt.shareListingCancelPlan;
    if (!isShareListingCancelPlan(stored)) {
      await failMoneyFlowReceipt(
        receipts(db),
        receipt._id,
        "share-listing-cancel:plan-never-stored"
      );
      results.push({ cancelKey: receipt._id, action: "settled-failed-no-plan" });
      continue;
    }
    const result = await runStoredCancelPlan(db, receipt._id, stored);
    results.push({
      cancelKey: receipt._id,
      action: result.ok ? "cancel-recovered" : "cancel-incomplete",
    });
  }
  if (results.length >= limit) return results;
  const planless = await receiptsEx(db)
    .find({ status: "in_progress", shareListingCancelPlan: { $exists: false } })
    .limit(limit - results.length)
    .toArray();
  for (const receipt of planless) {
    if (typeof receipt._id !== "string") continue;
    if (
      typeof receipt.fingerprint !== "string" ||
      !receipt.fingerprint.startsWith(SHARE_LISTING_CANCEL_FINGERPRINT_DOMAIN)
    ) {
      continue;
    }
    await failMoneyFlowReceipt(receipts(db), receipt._id, "share-listing-cancel:plan-never-stored");
    results.push({ cancelKey: receipt._id, action: "settled-failed-no-plan" });
  }
  return results;
}

type PreparedRefund = {
  offer: ShareOffer;
  subjectType: "character" | "corporation";
  subjectId: ShareOffer["buyerCharacterId"] | NonNullable<ShareOffer["buyerCorporationId"]>;
  subjectName: string;
  currencyCode: CurrencyCode;
  refundAmount: number;
};

/**
 * Cancel an open share listing: mark it cancelled, refund all pending offer
 * escrows to buyers, and return reserved shares to the seller.
 *
 * Escrows on each offer are denominated in the listing corporation's
 * `liquidCurrencyCode`. Every FX prerequisite and buyer-existence check runs
 * before any write, so a temporary rate outage or a missing buyer never
 * strands escrow; the keyed flow then settles the cancel exactly once.
 */
export async function cancelShareListingAndRefund(
  db: Db,
  listing: ShareListing,
  now: Date,
  forexEnabled: boolean,
  /** Pre-fetched listing corp doc. Omit to have the helper fetch its own copy. */
  listingCorpDocOverride?: Corporation | null,
  opts: { idempotencyKey?: string } = {}
): Promise<CancelListingResult | CancelListingError> {
  if (listing.status !== "open") return { ok: false, error: "Listing is not open" };

  const pendingOffers = await db
    .collection<ShareOffer>("shareOffers")
    .find({ listingId: listing._id, status: "pending" })
    .toArray();

  const listingCorpDoc =
    listingCorpDocOverride ??
    (await db.collection<Corporation>("corporations").findOne({ _id: listing.corporationId }));
  const listingCorpFxRate = await getCorpFxRate(db, listingCorpDoc ?? {});

  const buyerCorpIds = [
    ...new Set(
      pendingOffers.flatMap((offer) =>
        offer.buyerCorporationId ? [offer.buyerCorporationId.toString()] : []
      )
    ),
  ];
  const buyerCharIds = [
    ...new Set(
      pendingOffers
        .filter((offer) => !offer.buyerCorporationId)
        .map((offer) => offer.buyerCharacterId.toString())
    ),
  ];

  const [buyerCorpDocs, buyerCharDocs, fxByCurrency] = await Promise.all([
    buyerCorpIds.length > 0
      ? db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: buyerCorpIds.map((id) => new ObjectId(id)) } })
          .toArray()
      : Promise.resolve([] as Corporation[]),
    buyerCharIds.length > 0
      ? db
          .collection<Character>("characters")
          .find(
            { _id: { $in: buyerCharIds.map((id) => new ObjectId(id)) } },
            { projection: { _id: 1, countryId: 1, name: 1 } }
          )
          .toArray()
      : Promise.resolve([] as Pick<Character, "_id" | "countryId" | "name">[]),
    forexEnabled ? loadFxRatesByCurrency(db) : Promise.resolve(null),
  ]);

  const buyerCorpById = new Map(buyerCorpDocs.map((corp) => [corp._id.toString(), corp]));
  const buyerCharById = new Map(buyerCharDocs.map((char) => [char._id.toString(), char]));
  const preparedRefunds: PreparedRefund[] = [];

  for (const offer of pendingOffers) {
    const refundAnchor = corpLiquidCapitalToAnchor(
      offer.escrowAmount,
      listingCorpDoc ?? {},
      listingCorpFxRate
    );

    if (offer.buyerCorporationId) {
      const buyerCorp = buyerCorpById.get(offer.buyerCorporationId.toString());
      if (!buyerCorp) {
        return { ok: false, error: "Buyer corporation not found" };
      }
      const buyerFxRate = await getCorpFxRate(db, buyerCorp);
      preparedRefunds.push({
        offer,
        subjectType: "corporation",
        subjectId: offer.buyerCorporationId,
        subjectName: buyerCorp.name,
        currencyCode: resolveCorpLiquidCurrencyCode(buyerCorp) ?? "USD",
        refundAmount: anchorToCorpLiquidCapital(refundAnchor, buyerCorp, buyerFxRate),
      });
      continue;
    }

    const buyerChar = buyerCharById.get(offer.buyerCharacterId.toString());
    if (!buyerChar) {
      return { ok: false, error: "Buyer character not found" };
    }
    const homeCurrency = getHomeCurrency(buyerChar);
    if (forexEnabled && fxByCurrency && homeCurrency !== "USD" && !fxByCurrency.has(homeCurrency)) {
      return {
        ok: false,
        rateUnavailable: true,
        error: "Exchange rate unavailable, try again shortly",
      };
    }
    preparedRefunds.push({
      offer,
      subjectType: "character",
      subjectId: offer.buyerCharacterId,
      subjectName: buyerChar.name,
      currencyCode: homeCurrency,
      refundAmount: refundAnchor * (fxByCurrency?.get(homeCurrency) ?? 1),
    });
  }

  const currentTurn = await getCurrentTurn(db);
  const cancelKey = opts.idempotencyKey ?? randomUUID();

  // Seller-restore basis pinned from the live cap table, like the legacy
  // read-before-restore. The keyed cap credit recomputes the weighted
  // average from the same live state at apply time and converges on retry.
  let restoreLeg: ShareFillCapLeg | null = null;
  let returnPrice = listing.marketPriceAtCreation;
  if (listing.sharesRemaining > 0) {
    if (listing.sellerCorporationId) {
      const targetCorp = await db.collection<Corporation>("corporations").findOne(
        {
          _id: listing.corporationId,
          "shareholders.corporationId": listing.sellerCorporationId,
        },
        { projection: { "shareholders.$": 1 } }
      );
      const existingAvg =
        targetCorp?.shareholders?.[0]?.avgCostPerShare ?? listing.marketPriceAtCreation;
      returnPrice = existingAvg;
      restoreLeg = {
        field: "corporationId",
        idHex: listing.sellerCorporationId.toHexString(),
        pricePerShare: existingAvg,
      };
    } else {
      const targetCorp = await db
        .collection<Corporation>("corporations")
        .findOne(
          { _id: listing.corporationId, "shareholders.characterId": listing.sellerCharacterId },
          { projection: { "shareholders.$": 1 } }
        );
      returnPrice = targetCorp?.shareholders?.[0]?.avgCostPerShare ?? listing.marketPriceAtCreation;
      restoreLeg = {
        field: "characterId",
        idHex: listing.sellerCharacterId.toHexString(),
        pricePerShare: returnPrice,
      };
    }
  }

  const plan: ShareListingCancelPlan = {
    version: 1,
    cancelKey,
    listingIdHex: listing._id.toHexString(),
    corpIdHex: listing.corporationId.toHexString(),
    turn: currentTurn,
    nowIso: now.toISOString(),
    forexEnabled,
    sharesRemaining: listing.sharesRemaining,
    restoreLeg,
    returnPrice,
    refunds: preparedRefunds.map((refund) => ({
      offerIdHex: refund.offer._id.toHexString(),
      subjectType: refund.subjectType,
      subjectIdHex: refund.subjectId.toHexString(),
      subjectName: refund.subjectName,
      currencyCode: refund.currencyCode,
      refundLeg:
        refund.subjectType === "corporation"
          ? {
              collection: "corporations",
              idHex: refund.subjectId.toHexString(),
              field: "liquidCapital",
              amount: refund.refundAmount,
            }
          : {
              collection: "characters",
              idHex: refund.subjectId.toHexString(),
              field: personalBalanceField(refund.currencyCode, forexEnabled),
              amount: refund.refundAmount,
            },
      shares: refund.offer.shares,
      pricePerShare: refund.offer.pricePerShare,
      missingError:
        refund.subjectType === "corporation"
          ? "Buyer corporation not found"
          : "Buyer character not found",
      txMeta: { shares: refund.offer.shares, pricePerShare: refund.offer.pricePerShare },
    })),
  };

  try {
    const result = await executeShareListingCancelFlow(db, plan, { idempotencyKey: cancelKey });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    return { ok: true, ...result.body };
  } catch (error) {
    if (error instanceof MoneyFlowTerminalError || error instanceof MoneyFlowKeyConflictError) {
      return { ok: false, error: "Cancel already settled; retry with a new key" };
    }
    throw error;
  }
}
