/**
 * Index-fund redemption settlement (cron Pass 3c).
 *
 * Split out of `./fundCron` when that engine crossed the 2,000 LOC
 * architecture cap: every queued-redemption helper lives here
 * (`processQueuedRedemptions`, the stale-`processing` reaper, and the
 * quarantined-payout retry/reconcile paths). `runIndexFundCron` calls
 * `processQueuedRedemptions` once per turn; `fundCron` re-exports this
 * module's public surface so existing importers keep working.
 */ import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type {
  IndexFund,
  IndexFundRedemptionDebitMarker,
  IndexFundRedemptionQueueEntry,
  IndexFundRedemptionReceipt,
  IndexFundRedemptionStatus,
} from "@/lib/db/types";
import {
  getFundById,
  listPendingRedemptions,
  insertFundTransaction,
  FUND_REDEMPTION_QUEUE_COLLECTION,
} from "@/lib/indexFunds/fundQueries";
import {
  quoteCashOnlyRedemption,
  proRataRedemptionCashShare,
} from "@/lib/indexFunds/unitAccounting";
import { sellFundHoldingsForRedemptionCash } from "@/lib/indexFunds/fundRedemptionLiquidity";
import { sellFundBondHoldingsForCash } from "@/lib/bonds/sellFundBondUnits";
import { buildPersonalBalanceInc, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import {
  redemptionEntryStatusAfterPayout,
  remainingRedemptionUnits,
} from "@/lib/indexFunds/fundRedemptionQueue";
import { logIndexFundRedeem, resolveIndexFundHolder } from "@/lib/indexFunds/fundTxLog";
import { emitTx, loadTxThresholds } from "@/lib/financialTxLog/emit";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
// ── Pass 3c: Process queued redemptions ───────────────────────────────

/**
 * Age past which a `processing` redemption row is reconciled from durable
 * truth. A single payout claim-to-finalize is milliseconds of sequential
 * writes, so five minutes means the owner crashed or stalled mid-settlement,
 * not that it is slow. Staleness is NOT proof the owner died: on standalone
 * Mongo a lease expiry cannot distinguish a dead owner from a stalled one
 * that resumes at any moment, so the reaper below fails closed (keeps the
 * debit marker, quarantines the row) instead of refunding or restoring from
 * an ambiguous state.
 */
export const STALE_REDEMPTION_PROCESSING_MS = 5 * 60 * 1000;

export interface RedemptionReapResult {
  reaped: number;
  restored: number;
  /**
   * Always 0: the reaper never refunds. A stale marker plus an unproven
   * holder credit is ambiguous (the owner may still credit), so the reaper
   * keeps the debit marker and quarantines instead. Refunds happen only on
   * live-owner paths that prove their own credit never landed, and on the
   * explicit manual `reconcileQuarantinedRedemption`. Kept for shape
   * stability.
   */
  refunded: number;
  finalized: number;
  skippedLegacy: number;
  quarantined: number;
}

/**
 * Per-attempt settlement id, unique across restarts. Ties the queue journal
 * (`processingAttempt.attemptKey`) to the fund-side debit marker and the
 * holder-side credit receipt. Never reused: a replay after a restore mints a
 * fresh key, so a stale marker or receipt can never alias a new attempt. The
 * random suffix closes the same-millisecond reclaim alias (claim, restore,
 * and reclaim inside one ms would otherwise re-mint the identical key and a
 * new attempt's receipt guard could match the old attempt's receipt).
 */
export function redemptionAttemptKey(entryId: ObjectId, claimedAt: Date): string {
  return `rx-${entryId.toString()}-${claimedAt.getTime()}-${Math.random().toString(36).slice(2, 10)}`;
}

const debitMarkerPath = (attemptKey: string): string => `redemptionDebitMarkers.${attemptKey}`;

/**
 * Refund a marked fund debit exactly once (cash, plus supply for legacy-burn
 * rows). The marker is removed atomically with the refund, so a retry, a
 * second reaper, or an owner resolving the same attempt finds no marker and
 * moves no money: concurrent refund attempts converge to a single refund.
 * Returns true when this call performed the refund.
 */
async function refundMarkedDebit(
  db: Db,
  fundId: IndexFund["_id"],
  attemptKey: string,
  marker: Pick<IndexFundRedemptionDebitMarker, "amountAnchor" | "units">
): Promise<boolean> {
  const path = debitMarkerPath(attemptKey);
  const result = await db.collection<IndexFund>("indexFunds").updateOne(
    { _id: fundId, [path]: { $exists: true } },
    {
      $inc: {
        cashAnchor: marker.amountAnchor,
        ...(marker.units > 0 ? { unitSupply: marker.units } : {}),
      },
      $unset: { [path]: "" },
      $set: { updatedAt: new Date() },
    }
  );
  return result.matchedCount === 1;
}

type DebitMarkerRead =
  | { status: "present"; marker: IndexFundRedemptionDebitMarker }
  | { status: "absent" }
  | { status: "unknown" };

/** Read this attempt's fund-side debit marker: durable proof the debit landed. */
async function readDebitMarker(
  db: Db,
  fundId: IndexFund["_id"],
  attemptKey: string
): Promise<DebitMarkerRead> {
  let fund: IndexFund | null;
  try {
    fund = await getFundById(db, fundId);
  } catch {
    return { status: "unknown" };
  }
  if (!fund) return { status: "unknown" };
  const marker = fund.redemptionDebitMarkers?.[attemptKey];
  return marker ? { status: "present", marker } : { status: "absent" };
}

type HolderReceiptRead =
  | { status: "credited"; receipt: IndexFundRedemptionReceipt }
  | { status: "absent" }
  | { status: "holder-missing" }
  | { status: "unknown" };

function asReceiptArray(value: unknown): IndexFundRedemptionReceipt[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is IndexFundRedemptionReceipt =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as { key?: unknown }).key === "string"
  );
}

/**
 * Read this attempt's holder-side credit receipt: durable proof the holder
 * credit landed. Reads are projected to the receipts array only (NPP
 * documents are 31 KB; only the receipts are needed here) and run solely on
 * failure/recovery paths, never on the payout hot path.
 */
async function readHolderReceipt(
  db: Db,
  entry: IndexFundRedemptionQueueEntry,
  attemptKey: string
): Promise<HolderReceiptRead> {
  const pick = (doc: { redemptionReceipts?: unknown } | null): HolderReceiptRead => {
    if (!doc) return { status: "holder-missing" };
    const receipt = asReceiptArray(doc.redemptionReceipts).find((r) => r.key === attemptKey);
    return receipt ? { status: "credited", receipt } : { status: "absent" };
  };
  try {
    if (entry.characterId) {
      const rows = await db
        .collection("characters")
        .find({ _id: entry.characterId })
        .project({ redemptionReceipts: 1 })
        .toArray();
      return pick((rows[0] as { redemptionReceipts?: unknown } | undefined) ?? null);
    }
    if (entry.imperialCharacterId) {
      const rows = await db
        .collection("imperialCharacters")
        .find({ _id: entry.imperialCharacterId })
        .project({ redemptionReceipts: 1 })
        .toArray();
      return pick((rows[0] as { redemptionReceipts?: unknown } | undefined) ?? null);
    }
    if (entry.nppId) {
      // Projected: NPP docs are 31 KB, only the receipts array is needed here.
      const rows = await db
        .collection("npps")
        .find({ _id: entry.nppId })
        .project({ redemptionReceipts: 1 })
        .toArray();
      return pick((rows[0] as { redemptionReceipts?: unknown } | undefined) ?? null);
    }
  } catch {
    return { status: "unknown" };
  }
  return { status: "holder-missing" };
}

/**
 * Complete a payout's queue bookkeeping without moving money: for a payout
 * whose fund debit and holder credit both landed. Conditional on the row
 * still carrying this attempt's journal, so a concurrent resolver (owner or
 * reaper) that already finalized or restored the row wins and this call is a
 * safe no-op. Returns true when this call finalized the row.
 */
async function finalizePayoutBookkeeping(
  db: Db,
  rowId: IndexFundRedemptionQueueEntry["_id"],
  attemptKey: string,
  figures: Pick<IndexFundRedemptionReceipt, "amountAnchor" | "remainingUnits" | "nav">,
  paidBefore: number
): Promise<boolean> {
  const remaining = Math.max(0, figures.remainingUnits);
  const result = await db
    .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
    .updateOne(
      { _id: rowId, status: "processing", "processingAttempt.attemptKey": attemptKey },
      {
        $set: {
          status: redemptionEntryStatusAfterPayout(remaining),
          paidAmountAnchor: paidBefore + figures.amountAnchor,
          units: remaining,
          requestedAmountAnchor: remaining * figures.nav,
          updatedAt: new Date(),
        },
        $unset: { processingStartedAt: "", processingAttempt: "" },
      }
    );
  return result.matchedCount === 1;
}

/**
 * Restore a processing claim to its pre-claim status and clear the journal.
 * Conditional on the row still carrying this attempt's journal, so it can
 * never clobber a newer attempt's claim or a concurrent resolver's outcome.
 * Returns true when this call restored the row.
 */
async function restorePayoutClaim(
  db: Db,
  rowId: IndexFundRedemptionQueueEntry["_id"],
  from: IndexFundRedemptionStatus,
  attemptKey: string
): Promise<boolean> {
  const result = await db
    .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
    .updateOne(
      { _id: rowId, status: "processing", "processingAttempt.attemptKey": attemptKey },
      {
        $set: { status: from, updatedAt: new Date() },
        $unset: { processingStartedAt: "", processingAttempt: "" },
      }
    );
  return result.matchedCount === 1;
}

/**
 * Reconcile this fund's stale `processing` redemption rows after a crash
 * (#2223). The queue journal (`processingAttempt`) is only a pointer: every
 * decision is read off the two durable markers written atomically with their
 * money legs, the fund-side debit marker and the holder-side credit receipt:
 * - no journal (legacy row) — left untouched for manual reconciliation. The
 *   old code could strand these either side of the holder credit, so replaying
 *   them blind risks a double payout.
 * - journaled, no debit marker — the debit never landed (or was already
 *   refunded); restore to the pre-claim status with no money movement.
 * - journaled debit marker, receipt present — both money legs landed; finalize
 *   the queue bookkeeping from the receipt's figures without moving money
 *   again. Audit rows (fund transaction, ledger) are evidence only and are
 *   NOT re-emitted here: the crash may have landed them already, and a
 *   duplicate audit row is worse than a missing one.
 * - journaled debit marker, receipt absent / holder gone / receipt
 *   unreadable — AMBIGUOUS, even when the receipt reads cleanly absent: on
 *   standalone Mongo a lease expiry is not proof the owner died, and a
 *   stalled owner may credit at any moment, including between the receipt
 *   read below and the write after it. Fail closed: keep the fund debit
 *   marker (never refund) and quarantine the row conditionally on still
 *   owning this attempt, stamping the outstanding debit as the
 *   reconciliation obligation. Refunding would mint money if the credit
 *   landed or lands; restoring would replay a paid entry. A truly dead
 *   owner is resolved later through the explicit manual
 *   `reconcileQuarantinedRedemption`, never by an automatic refund.
 *
 * Reaper claims are atomic (exact `processingStartedAt` match), so
 * concurrent reapers resolve each row exactly once. The quarantine write is
 * conditional on the row still carrying this attempt (`processing` + same
 * attempt key), so a reaper delayed after reading no receipt cannot clobber
 * an owner that finalized in the meantime: the write matches nothing and
 * the reaper stands down.
 *
 * Lease race (owner stalled past the lease, reaper quarantines, owner
 * resumes and credits): the pre-credit fence closes it when the stall is
 * before the fence. A stall between fence and credit (or credit and
 * finalize) lands a STILL-BACKED credit, because the marker was kept: the
 * owner's conditional finalize still matches (the quarantine kept the same
 * attempt key) and the payout completes exactly once, clearing the marker
 * on the owner's pass. An unbacked holder credit now arises only when a
 * concurrent resolver refunds the debit out from under a live owner — which
 * the reaper no longer does, leaving only an operator's manual
 * refund-and-restore racing the owner — and the owner's conditional
 * finalize then loses and resolveLostFinalizeRace reverses the credit
 * receipt-guarded (exactly once, verified by re-read) instead of auditing
 * or replaying. An unverifiable reversal quarantines the restored row
 * durably with the exact reversal figures (never a warn-log-only
 * obligation, never silently conserved), and
 * retryQuarantinedHolderReversal replays nothing until the receipt is
 * proven gone. Only a transaction (replica set) removes the check-to-act
 * windows entirely.
 */
export async function reapStaleRedemptionProcessing(
  db: Db,
  fundId: IndexFund["_id"],
  options?: { staleAfterMs?: number; now?: Date }
): Promise<RedemptionReapResult> {
  const result: RedemptionReapResult = {
    reaped: 0,
    restored: 0,
    refunded: 0,
    finalized: 0,
    skippedLegacy: 0,
    quarantined: 0,
  };
  const staleAfterMs = options?.staleAfterMs ?? STALE_REDEMPTION_PROCESSING_MS;
  const now = options?.now ?? new Date();
  const queue = db.collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION);
  const stale = await queue
    .find({
      fundId,
      status: "processing",
      processingStartedAt: { $lt: new Date(now.getTime() - staleAfterMs) },
    })
    .toArray();
  const skippedIds: string[] = [];
  const quarantinedIds: string[] = [];
  // Outstanding debits parked on quarantined rows: the explicit
  // reconciliation obligation (never silently conserved).
  let quarantinedAnchor = 0;
  // Fund debit markers, loaded lazily on the first journaled row: the common
  // case (no stale rows, or only legacy rows) costs no extra round trip.
  let fundMarkers: Record<string, IndexFundRedemptionDebitMarker> | undefined;
  // Finalized rows' markers are cleared in one batched write below.
  const markersToClear = new Set<string>();
  for (const row of stale) {
    // Atomic claim: only one reaper wins per lease period.
    const claim = await queue.updateOne(
      { _id: row._id, status: "processing", processingStartedAt: row.processingStartedAt },
      { $set: { processingStartedAt: now, updatedAt: now } }
    );
    if (claim.matchedCount !== 1) continue;
    const fresh = await queue.findOne({ _id: row._id });
    if (!fresh || fresh.status !== "processing") continue;
    const attempt = fresh.processingAttempt;
    if (
      !attempt ||
      typeof attempt.attemptKey !== "string" ||
      (attempt.from !== "queued" && attempt.from !== "partial")
    ) {
      result.skippedLegacy++;
      skippedIds.push(row._id.toString());
      continue;
    }
    if (attempt.quarantined) {
      // Terminal fail-closed state: counted, never retried, never warned twice.
      result.quarantined++;
      continue;
    }
    result.reaped++;
    const attemptKey = attempt.attemptKey;
    if (fundMarkers === undefined) {
      try {
        fundMarkers = (await getFundById(db, fundId))?.redemptionDebitMarkers ?? {};
      } catch {
        // The fund read failed: leave this row for the next pass rather than
        // deciding refund-vs-restore blind.
        result.reaped--;
        console.warn(
          `[indexfund-cron] could not read fund ${fundId.toString()} to reconcile stale redemption ${row._id.toString()}; leaving it for the next pass`
        );
        continue;
      }
    }
    const marker = fundMarkers[attemptKey];
    if (!marker) {
      // No outstanding debit: the owner died before the debit, or a previous
      // reaper already refunded (its marker-atomic refund is exactly-once, so
      // there is nothing left to refund). Restore with no money movement.
      await restorePayoutClaim(db, row._id, attempt.from, attemptKey);
      result.restored++;
      continue;
    }
    let receipt: HolderReceiptRead;
    try {
      receipt = await readHolderReceipt(db, fresh, attemptKey);
    } catch {
      receipt = { status: "unknown" };
    }
    if (receipt.status === "credited") {
      // Both legs landed: finalize bookkeeping from the receipt's durable
      // figures. No money moves, no audit rows are re-emitted.
      await finalizePayoutBookkeeping(
        db,
        row._id,
        attemptKey,
        {
          amountAnchor: receipt.receipt.amountAnchor,
          remainingUnits: receipt.receipt.remainingUnits,
          nav: receipt.receipt.nav,
        },
        fresh.paidAmountAnchor ?? 0
      );
      markersToClear.add(attemptKey);
      // Retain the receipt after finalization. An owner paused before its
      // credit may resume after this reaper; removing the key would reopen
      // the idempotency guard and permit a second holder credit.
      result.finalized++;
      continue;
    }
    // Marker present, receipt not provably credited (absent, holder gone,
    // or unreadable): ambiguous. A clean "absent" read is NOT proof the
    // owner will never credit — the owner may be stalled and resume between
    // this read and the write below, and on standalone Mongo the lease
    // expiry above proves nothing about the owner's liveness. Fail closed:
    // keep the debit marker and quarantine the row conditionally on still
    // owning this attempt, stamping the outstanding debit as the
    // reconciliation obligation. Never refund (would mint money if the
    // credit landed or lands) and never restore (would replay a paid
    // entry). A still-active owner that credits while this attempt remains
    // `processing` finalizes through the quarantine (same attempt key); a
    // truly dead owner is resolved later via the explicit manual
    // `reconcileQuarantinedRedemption`.
    const quarantined = await queue.updateOne(
      { _id: row._id, status: "processing", "processingAttempt.attemptKey": attemptKey },
      {
        $set: {
          processingStartedAt: now,
          "processingAttempt.quarantined": true,
          "processingAttempt.outstandingAnchor": marker.amountAnchor,
          "processingAttempt.outstandingUnits": marker.units,
          updatedAt: now,
        },
      }
    );
    if (quarantined.matchedCount !== 1) {
      // The row moved on while this reaper was reading truth: the owner
      // finalized (or restored) it concurrently, or the marker/refund path
      // of a live owner resolved it. The conditional write above matched
      // nothing, so nothing was clobbered: stand down without counting,
      // warning, or touching money.
      continue;
    }
    result.quarantined++;
    quarantinedIds.push(row._id.toString());
    quarantinedAnchor += marker.amountAnchor;
  }
  if (markersToClear.size > 0) {
    const unset: Record<string, ""> = {};
    for (const key of markersToClear) unset[debitMarkerPath(key)] = "";
    await db.collection<IndexFund>("indexFunds").updateOne({ _id: fundId }, { $unset: unset });
  }
  if (skippedIds.length > 0) {
    console.warn(
      `[indexfund-cron] ${skippedIds.length} stale processing redemption(s) left for manual reconciliation (no recovery journal): ${skippedIds.join(", ")}`
    );
  }
  if (quarantinedIds.length > 0) {
    console.warn(
      `[indexfund-cron] ${quarantinedIds.length} stale processing redemption(s) quarantined for manual reconciliation (debit marker kept, holder credit unproven, ${quarantinedAnchor} anchor debit outstanding; resolve via reconcileQuarantinedRedemption): ${quarantinedIds.join(", ")}`
    );
  }
  return result;
}

/** Holder collection + id for receipt reads and explicit reversal. */
function holderReceiptCollection(
  entry: IndexFundRedemptionQueueEntry
): { collection: "characters" | "imperialCharacters" | "npps"; id: ObjectId } | null {
  if (entry.characterId) return { collection: "characters", id: entry.characterId };
  if (entry.imperialCharacterId)
    return { collection: "imperialCharacters", id: entry.imperialCharacterId };
  if (entry.nppId) return { collection: "npps", id: entry.nppId };
  return null;
}

/**
 * Credit one queued-redemption payout to its holder, writing the durable
 * receipt atomically with the credit. The receipt guard (`receipts.key $ne
 * attemptKey`) makes the credit idempotent: a replay of the same attempt can
 * never credit twice, and the owner/reaper can tell "credit landed" from
 * "credit never attempted" by reading the receipt instead of guessing.
 * Returns true when the holder was credited, false when there is no holder
 * to credit (unknown holder shape, or the holder document is gone). Throws
 * on write failure so the caller can resolve the attempt from durable truth.
 */
async function creditRedemptionHolder(
  db: Db,
  entry: IndexFundRedemptionQueueEntry,
  receipt: IndexFundRedemptionReceipt,
  paidNative: number,
  paidAmountAnchor: number,
  anchorCurrencyCode: CurrencyCode,
  forexEnabled: boolean
): Promise<boolean> {
  const now = new Date();
  const receiptGuard = { "redemptionReceipts.key": { $ne: receipt.key } };
  if (entry.characterId) {
    const inc = buildPersonalBalanceInc(paidNative, anchorCurrencyCode, forexEnabled);
    const creditResult = await db.collection("characters").updateOne(
      { _id: entry.characterId, ...receiptGuard },
      {
        $inc: inc,
        $addToSet: { redemptionReceipts: receipt },
        $set: { updatedAt: now },
      }
    );
    return creditResult.matchedCount !== 0;
  }
  if (entry.imperialCharacterId) {
    const inc = buildPersonalBalanceInc(paidNative, anchorCurrencyCode, forexEnabled);
    const creditResult = await db.collection("imperialCharacters").updateOne(
      { _id: entry.imperialCharacterId, ...receiptGuard },
      {
        $inc: inc,
        $addToSet: { redemptionReceipts: receipt },
        $set: { updatedAt: now },
      }
    );
    return creditResult.matchedCount !== 0;
  }
  if (entry.nppId) {
    // NPP investment cash stays in anchor (₳): the redeemFxRate wallet
    // multiplier applies to character/imperial credits only.
    const creditResult = await db.collection("npps").updateOne(
      { _id: entry.nppId, ...receiptGuard },
      {
        $inc: { nppInvestmentCashAnchor: paidAmountAnchor },
        $addToSet: { redemptionReceipts: receipt },
        $set: { updatedAt: now },
      }
    );
    return creditResult.matchedCount !== 0;
  }
  return false;
}

/**
 * Reverse this attempt's holder credit, conditionally on our receipt still
 * being present: the guard makes the reversal idempotent (a retry or a
 * concurrent resolver converges to one reversal) and lets a holder state we
 * no longer recognize (deleted, recreated, re-credited) win instead of being
 * debited blind. Returns true when this call removed the credit.
 */
async function reverseHolderCredit(
  db: Db,
  entry: IndexFundRedemptionQueueEntry,
  receiptKey: string,
  paidNative: number,
  paidAmountAnchor: number,
  anchorCurrencyCode: CurrencyCode,
  forexEnabled: boolean
): Promise<boolean> {
  const target = holderReceiptCollection(entry);
  if (!target) return false;
  let inc: Record<string, number> | null = null;
  if (entry.characterId || entry.imperialCharacterId) {
    const credit = buildPersonalBalanceInc(paidNative, anchorCurrencyCode, forexEnabled);
    inc = Object.fromEntries(Object.entries(credit).map(([k, v]) => [k, -v]));
  } else if (entry.nppId) {
    inc = { nppInvestmentCashAnchor: -paidAmountAnchor };
  }
  if (!inc) return false;
  try {
    const result = await db
      .collection<{ redemptionReceipts?: IndexFundRedemptionReceipt[] }>(target.collection)
      .updateOne(
        { _id: target.id, "redemptionReceipts.key": receiptKey },
        {
          $inc: inc,
          $pull: { redemptionReceipts: { key: receiptKey } },
          $set: { updatedAt: new Date() },
        }
      );
    return result.matchedCount === 1;
  } catch {
    return false;
  }
}

/**
 * Quarantine a restored queue row that carries an unbacked (or unverifiable)
 * holder credit (#2223, owner side). The reaper already returned this row to
 * its payable status, so without this write the next pass would replay it
 * and pay the holder a second time. The write is conditional on the row
 * still sitting in that restored state (same status and unpaid figures), so
 * it can never clobber a newer attempt's claim or a concurrent resolver's
 * outcome: a newer claim runs under `processing` with a fresh key, and a
 * replay that already paid changed the figures. The stamped
 * `unreversed*` figures are the explicit reconciliation obligation and the
 * exact inputs `retryQuarantinedHolderReversal` needs; the row stays
 * non-replayable (`processing`, invisible to `listPendingRedemptions`) until
 * that retry proves the receipt gone. Returns true when the quarantine
 * landed. A false return means the row already moved on (re-claimed or
 * paid): the caller must escalate loudly, because a double-pay may already
 * be in flight.
 */
async function quarantineUnbackedHolderCredit(
  db: Db,
  rowId: IndexFundRedemptionQueueEntry["_id"],
  from: IndexFundRedemptionStatus,
  attemptKey: string,
  paidAnchorBefore: number,
  unitsBefore: number,
  reversal: { amountAnchor: number; paidNative: number; units: number }
): Promise<boolean> {
  const result = await db
    .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
    .updateOne(
      {
        _id: rowId,
        status: from,
        paidAmountAnchor: paidAnchorBefore,
        units: unitsBefore,
      },
      {
        $set: {
          status: "processing",
          processingStartedAt: new Date(),
          "processingAttempt.from": from,
          "processingAttempt.attemptKey": attemptKey,
          "processingAttempt.quarantined": true,
          "processingAttempt.outstandingAnchor": 0,
          "processingAttempt.outstandingUnits": 0,
          "processingAttempt.unreversedReceiptKey": attemptKey,
          "processingAttempt.unreversedAmountAnchor": reversal.amountAnchor,
          "processingAttempt.unreversedNative": reversal.paidNative,
          "processingAttempt.unreversedUnits": reversal.units,
          updatedAt: new Date(),
        },
      }
    );
  return result.matchedCount === 1;
}

/**
 * Resolve a lost finalize race after this attempt's holder credit landed
 * (#2223 lease race). The finalize is conditional on still owning the row, so
 * losing it means a concurrent resolver (reaper) already finalized or
 * restored the row. Every outcome is read off durable truth, never assumed:
 * - receipt credited, debit marker absent: a concurrent resolver refunded
 *   the debit and restored the row while we were stalled between fence and
 *   credit (or credit and finalize) — the reaper itself never refunds, so
 *   this is an operator's manual refund-and-restore racing a live owner —
 *   and our credit then landed UNBACKED. Reverse it (receipt-guarded, so
 *   exactly once) and verify the reversal by re-read. On a verified
 *   reversal the restored row is payable again and replays exactly once.
 * - reversal failed or unverifiable, or either truth unreadable: quarantine
 *   the restored row durably (`quarantineUnbackedHolderCredit`) with the
 *   exact reversal figures, so the queue is NEVER replayable while the
 *   unbacked receipt remains. A warn log alone is not safety: in standalone
 *   Mongo a lease expiry cannot prove the old owner died, so the obligation
 *   must live on the row until `retryQuarantinedHolderReversal` proves the
 *   receipt gone. Never silently conserved.
 * - receipt credited, marker present: the reaper finalized from our receipt
 *   (both legs landed, books correct); stand down without auditing twice.
 * - receipt absent, marker absent: both legs were resolved externally (or a
 *   delete/recreate shed the receipt after a correct finalize); stand down.
 * - receipt absent, marker present: a holder recreate may have shed the
 *   receipt; refunding here could double-refund a paid holder. Stand down.
 */
async function resolveLostFinalizeRace(
  db: Db,
  fundId: IndexFund["_id"],
  entry: IndexFundRedemptionQueueEntry,
  attemptKey: string,
  paidNative: number,
  paidAmountAnchor: number,
  anchorCurrencyCode: CurrencyCode,
  forexEnabled: boolean,
  paidUnits?: number
): Promise<void> {
  const rowId = entry._id.toString();
  let seen: HolderReceiptRead;
  try {
    seen = await readHolderReceipt(db, entry, attemptKey);
  } catch {
    seen = { status: "unknown" };
  }
  let marker: DebitMarkerRead;
  try {
    marker = await readDebitMarker(db, fundId, attemptKey);
  } catch {
    marker = { status: "unknown" };
  }
  if (seen.status === "credited" && marker.status === "absent") {
    const reversed = await reverseHolderCredit(
      db,
      entry,
      attemptKey,
      paidNative,
      paidAmountAnchor,
      anchorCurrencyCode,
      forexEnabled
    );
    if (reversed) {
      let verify: HolderReceiptRead;
      try {
        verify = await readHolderReceipt(db, entry, attemptKey);
      } catch {
        verify = { status: "unknown" };
      }
      if (verify.status === "absent") {
        console.warn(
          `[indexfund-cron] redemption payout for ${rowId} lost its finalize race after a reaper refund; reversed the unbacked holder credit of ${paidAmountAnchor} anchor (receipt ${attemptKey})`
        );
        return;
      }
    }
    // Fail closed: the unbacked credit may still be out AND the row is
    // replayable. Quarantine it with the exact reversal figures instead of
    // warn-logging an obligation no future pass would honor.
    const quarantined = await quarantineUnbackedHolderCredit(
      db,
      entry._id,
      entry.status,
      attemptKey,
      entry.paidAmountAnchor ?? 0,
      entry.units,
      { amountAnchor: paidAmountAnchor, paidNative, units: paidUnits ?? 0 }
    );
    if (quarantined) {
      console.warn(
        `[indexfund-cron] redemption payout for ${rowId} lost its finalize race after a reaper refund and the unbacked holder credit of ${paidAmountAnchor} anchor could not be verifiably reversed (receipt ${attemptKey}); row quarantined, manual reconciliation required via retryQuarantinedHolderReversal`
      );
      return;
    }
    console.warn(
      `[indexfund-cron] redemption payout for ${rowId} lost its finalize race after a reaper refund, the unbacked holder credit of ${paidAmountAnchor} anchor could not be verifiably reversed (receipt ${attemptKey}), AND the row could not be quarantined (already re-claimed or paid); manual reconciliation required immediately, a double-pay may be in flight`
    );
    return;
  }
  if (seen.status === "unknown" || marker.status === "unknown") {
    // Same fail-closed quarantine: the credit may have landed unbacked and
    // the row may be replayable. Stamp what this attempt knows (its own
    // credit figures); the retry resolves from truth reads.
    const quarantined = await quarantineUnbackedHolderCredit(
      db,
      entry._id,
      entry.status,
      attemptKey,
      entry.paidAmountAnchor ?? 0,
      entry.units,
      { amountAnchor: paidAmountAnchor, paidNative, units: paidUnits ?? 0 }
    );
    if (quarantined) {
      console.warn(
        `[indexfund-cron] redemption payout for ${rowId} lost its finalize race and settlement truth is unreadable (receipt ${attemptKey}); row quarantined with ${paidAmountAnchor} anchor possibly unbacked, manual reconciliation required via retryQuarantinedHolderReversal`
      );
      return;
    }
    console.warn(
      `[indexfund-cron] redemption payout for ${rowId} lost its finalize race, settlement truth is unreadable (receipt ${attemptKey}), AND the row could not be quarantined (already re-claimed or paid); manual reconciliation required immediately`
    );
    return;
  }
  // All remaining combinations (credited+present, absent+absent,
  // absent+present, holder-missing with no marker) were reconciled
  // externally: both legs accounted for, or nothing outstanding. Stand down
  // without moving money or touching the row.
}

/**
 * Retry the receipt-guarded reversal for a quarantined unbacked holder
 * credit, then restore the row to payable ONLY on verified clean truth
 * (#2223 reconciliation obligation). Fail-closed at every step:
 * - row not quarantined `processing`, or carrying no unreversed receipt and
 *   no outstanding debit: nothing to do.
 * - receipt still credited and the reversal fails or is unverified: the
 *   quarantine stands (returns `still-quarantined`).
 * - receipt credited but the journal carries no reversal figures (a
 *   reaper-quarantined row whose credit state was never provable): the
 *   retry cannot know what to debit, so the quarantine stands for a human.
 * - receipt verifiably absent but a fund debit marker is outstanding (or
 *   unreadable): the quarantine stands. Refunding a quarantined row
 *   automatically is exactly what quarantine forbids.
 * - holder gone: the quarantine stands (a recreated holder must not be
 *   debited blind, and restoring could replay against it).
 * - receipt verifiably absent AND no marker outstanding: restore to the
 *   pre-claim status (conditional, so a concurrent resolver wins) and return
 *   `restored`. The next pass then pays the entry exactly once.
 *
 * Supported configurations: the payout legs are plain conditional writes
 * with no session, so this retry runs identically on a replica set and on
 * standalone Mongo. Only a transaction (replica set) would remove the
 * underlying check-to-act windows; the queue payout path does not use one
 * on either configuration, which is why this protocol exists.
 */
export type QuarantinedReversalOutcome = "restored" | "still-quarantined" | "not-quarantined";

export async function retryQuarantinedHolderReversal(
  db: Db,
  fund: IndexFund,
  rowId: IndexFundRedemptionQueueEntry["_id"],
  forexEnabled: boolean
): Promise<QuarantinedReversalOutcome> {
  const queue = db.collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION);
  const row = await queue.findOne({ _id: rowId });
  const attempt = row?.processingAttempt;
  if (!row || row.status !== "processing" || !attempt || attempt.quarantined !== true) {
    return "not-quarantined";
  }
  const receiptKey = attempt.unreversedReceiptKey ?? attempt.attemptKey;
  let seen: HolderReceiptRead;
  try {
    seen = await readHolderReceipt(db, row, receiptKey);
  } catch {
    seen = { status: "unknown" };
  }
  if (seen.status === "credited") {
    // Reverse exactly what the stale owner credited. Without journaled
    // figures there is nothing safe to debit: stand the quarantine for a
    // human instead of guessing amounts.
    const amountAnchor = attempt.unreversedAmountAnchor;
    const paidNative = attempt.unreversedNative;
    if (typeof amountAnchor !== "number" || typeof paidNative !== "number") {
      console.warn(
        `[indexfund-cron] quarantined redemption ${rowId.toString()} still carries holder receipt ${receiptKey} with no journaled reversal figures; manual reconciliation required`
      );
      return "still-quarantined";
    }
    const reversed = await reverseHolderCredit(
      db,
      row,
      receiptKey,
      paidNative,
      amountAnchor,
      fund.anchorCurrencyCode,
      forexEnabled
    );
    if (!reversed) return "still-quarantined";
    let verify: HolderReceiptRead;
    try {
      verify = await readHolderReceipt(db, row, receiptKey);
    } catch {
      verify = { status: "unknown" };
    }
    if (verify.status !== "absent") {
      console.warn(
        `[indexfund-cron] quarantined redemption ${rowId.toString()} reversal of ${amountAnchor} anchor (receipt ${receiptKey}) could not be verified; quarantine stands, manual reconciliation required`
      );
      return "still-quarantined";
    }
  } else if (seen.status !== "absent") {
    // Unknown read or holder gone: fail closed, the quarantine stands.
    return "still-quarantined";
  }
  // Receipt verifiably absent. Restore only when no fund debit is
  // outstanding for this receipt: refunding or replaying past an outstanding
  // marker would mint money or double-pay.
  let marker: DebitMarkerRead;
  try {
    marker = await readDebitMarker(db, fund._id, receiptKey);
  } catch {
    marker = { status: "unknown" };
  }
  if (marker.status !== "absent") return "still-quarantined";
  const restored = await restorePayoutClaim(db, rowId, attempt.from, attempt.attemptKey);
  if (restored) {
    console.warn(
      `[indexfund-cron] quarantined redemption ${rowId.toString()} reversal verified (receipt ${receiptKey} gone, no debit outstanding); row restored to ${attempt.from} for replay`
    );
    return "restored";
  }
  const reread = await queue.findOne({ _id: rowId });
  return reread?.status === "processing" && reread?.processingAttempt?.quarantined === true
    ? "still-quarantined"
    : "not-quarantined";
}

/**
 * Explicit manual reconciliation for a quarantined redemption row (#2223).
 * This is the ONLY path that refunds a fund debit the reaper refused to
 * touch: the reaper quarantines ambiguous stale rows with the debit marker
 * kept, so a truly dead owner (debit outstanding, credit unproven, owner
 * never coming back) strands here until a human resolves it.
 *
 * Precondition the code cannot check: the caller must have proven the owner
 * stopped (owner process dead, lease long expired, no overlapping cron that
 * could still credit under this attempt key). If that proof is wrong and a
 * live owner credits between the receipt read and the refund below, the
 * credit lands unbacked — but NOT silently: the owner's conditional finalize
 * then loses and `resolveLostFinalizeRace` reverses the credit
 * receipt-guarded, quarantining on failure. The window degrades to the
 * handled unbacked-credit path; it never double-pays quietly.
 *
 * Decisions are explicit so a wrong guess cannot mint money:
 * - "refund-and-restore" requires a verifiably absent receipt AND (for the
 *   refund leg) a present marker; a present receipt refuses
 *   (`still-quarantined`) instead of refunding a paid holder. The restore is
 *   conditional on the row still carrying this quarantine, so a concurrent
 *   resolver wins and this call is a safe no-op (`not-quarantined`).
 * - "finalize-from-receipt" requires a credited receipt and completes the
 *   bookkeeping from its figures without moving money; a non-credited
 *   receipt refuses instead of finalizing thin air. The marker for this
 *   attempt is cleared (key-unique, so it cannot touch another attempt).
 * - Unreadable truth, a gone holder, or a non-`processing`/non-quarantined
 *   row all fail closed (`still-quarantined` / `not-quarantined`).
 *
 * A pending debit parked here is an explicit reconciliation obligation: it
 * is never called conserved, and this function never restores a row past an
 * outstanding or unreadable marker.
 */
export type QuarantinedReconcileDecision = "refund-and-restore" | "finalize-from-receipt";
export type QuarantinedReconcileOutcome =
  "restored" | "finalized" | "still-quarantined" | "not-quarantined";

export async function reconcileQuarantinedRedemption(
  db: Db,
  fundId: IndexFund["_id"],
  rowId: IndexFundRedemptionQueueEntry["_id"],
  decision: QuarantinedReconcileDecision
): Promise<QuarantinedReconcileOutcome> {
  const queue = db.collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION);
  const row = await queue.findOne({ _id: rowId });
  const attempt = row?.processingAttempt;
  if (
    !row ||
    row.status !== "processing" ||
    !attempt ||
    attempt.quarantined !== true ||
    typeof attempt.attemptKey !== "string" ||
    (attempt.from !== "queued" && attempt.from !== "partial")
  ) {
    return "not-quarantined";
  }
  const journalKey = attempt.attemptKey;
  const receiptKey = attempt.unreversedReceiptKey ?? attempt.attemptKey;
  let receipt: HolderReceiptRead;
  try {
    receipt = await readHolderReceipt(db, row, receiptKey);
  } catch {
    receipt = { status: "unknown" };
  }
  if (decision === "finalize-from-receipt") {
    // Wrong-decision guard: finalizing without a proven credit would book a
    // payout nobody received. Refuse instead of guessing.
    if (receipt.status !== "credited") return "still-quarantined";
    const finalized = await finalizePayoutBookkeeping(
      db,
      rowId,
      journalKey,
      {
        amountAnchor: receipt.receipt.amountAnchor,
        remainingUnits: receipt.receipt.remainingUnits,
        nav: receipt.receipt.nav,
      },
      row.paidAmountAnchor ?? 0
    );
    if (!finalized) return "not-quarantined";
    await db
      .collection<IndexFund>("indexFunds")
      .updateOne({ _id: fundId }, { $unset: { [debitMarkerPath(journalKey)]: "" } });
    console.warn(
      `[indexfund-cron] quarantined redemption ${rowId.toString()} manually finalized from receipt ${receiptKey} (${receipt.receipt.amountAnchor} anchor, no money moved)`
    );
    return "finalized";
  }
  // "refund-and-restore": the operator asserts the owner is dead and the
  // holder was never paid. Enforce both from truth reads.
  if (receipt.status !== "absent") return "still-quarantined";
  let marker: DebitMarkerRead;
  try {
    marker = await readDebitMarker(db, fundId, journalKey);
  } catch {
    marker = { status: "unknown" };
  }
  if (marker.status === "unknown") return "still-quarantined";
  if (marker.status === "present") {
    await refundMarkedDebit(db, fundId, journalKey, {
      amountAnchor: marker.marker.amountAnchor,
      units: marker.marker.units,
    });
  }
  const restored = await restorePayoutClaim(db, rowId, attempt.from, journalKey);
  if (!restored) return "not-quarantined";
  console.warn(
    `[indexfund-cron] quarantined redemption ${rowId.toString()} manually refunded and restored (receipt ${receiptKey} verifiably absent); entry is payable again`
  );
  return "restored";
}

/**
 * Pre-credit ownership fence: confirm this attempt still owns the row before
 * moving holder money. A reaper that claimed this row past the lease (owner
 * stalled, overlapping cron, slow turn) already accounted for the debit by
 * refunding or finalizing; crediting now would mint money the books do not
 * expect. Costs one projected read per payout on the hot path; the remaining
 * check-to-act race is milliseconds wide and documented on the reaper.
 */
async function attemptStillOwnsRow(
  db: Db,
  rowId: IndexFundRedemptionQueueEntry["_id"],
  attemptKey: string,
  claimedAt: Date
): Promise<boolean> {
  const rows = await db
    .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
    .find({ _id: rowId })
    .project({ status: 1, processingStartedAt: 1, processingAttempt: 1 })
    .toArray();
  const row = rows[0];
  return (
    !!row &&
    row.status === "processing" &&
    row.processingAttempt?.attemptKey === attemptKey &&
    row.processingStartedAt instanceof Date &&
    row.processingStartedAt.getTime() === claimedAt.getTime()
  );
}

export async function processQueuedRedemptions(
  db: Db,
  fund: IndexFund,
  forexEnabled: boolean,
  currentTurn: number,
  recovery?: { staleAfterMs?: number }
): Promise<number> {
  // Reconcile the previous pass's interrupted payouts before paying new ones,
  // so a crashed turn's stranded rows resolve from durable truth (restored
  // when nothing is outstanding, finalized when both legs landed,
  // quarantined with the debit marker kept when ambiguous) instead of
  // stranding in `processing` forever.
  await reapStaleRedemptionProcessing(db, fund._id, { staleAfterMs: recovery?.staleAfterMs });
  const pending = await listPendingRedemptions(db, fund._id);
  if (pending.length === 0) return 0;

  // #992 tranche 6: one batched NPP lookup for the pass so each NPP
  // redemption below can be denominated in the NPP home currency (the
  // npp:<id>:<homeCurrency> snapshot key) without a per-entry read.
  const nppCurrencyById = new Map<string, CurrencyCode>();
  const queuedNppObjectIds = pending.flatMap((e) => (e.nppId ? [e.nppId] : []));
  if (queuedNppObjectIds.length > 0) {
    const nppDocs = await db
      .collection<{ _id: ObjectId; countryId?: string }>("npps")
      .find({ _id: { $in: queuedNppObjectIds } })
      .project({ countryId: 1 })
      .toArray();
    for (const doc of nppDocs) {
      const cur = COUNTRY_CURRENCY_MAP[doc.countryId as keyof typeof COUNTRY_CURRENCY_MAP] ?? "USD";
      nppCurrencyById.set(doc._id.toString(), cur);
    }
  }

  // Wallet credits are in the fund's native currency; the ₳ → native multiplier
  // is stamped on each queue entry at request time (entry.redeemFxRate, ticket
  // #857 grandfather) — 1 for pre-fix legacy units, the fund rate for post-fix
  // units. Fund `cashAnchor` and NPP investment cash stay in ₳. We still gate on
  // rate availability so a momentary outage defers rather than risks a bad payout.
  if (forexEnabled) {
    const fxResult = await loadCharacterFxRate(db, fund.anchorCurrencyCode);
    if (!fxResult.ok) {
      // Rate unavailable — defer payouts to a later cycle.
      console.warn(
        `[indexfund-cron] deferring ${pending.length} queued redemption(s) for ${fund.slug}: FX rate for ${fund.anchorCurrencyCode} unavailable`
      );
      return 0;
    }
  }

  let paid = 0;
  let fundState = fund;
  let availableCash = fund.cashAnchor;
  // #992 tranche 6: thresholds for the bond-sale ledger rows below, loaded
  // at most once per redemption pass and only when a bond sale actually runs.
  let bondSaleThresholds: Awaited<ReturnType<typeof loadTxThresholds>> | undefined;

  // Units still unserved in this pass. Decremented as each entry is handled so
  // the share is measured against who is still waiting, not the original queue.
  let unservedUnits = pending.reduce((sum, e) => sum + Math.max(0, e.units ?? 0), 0);

  // Markers of finalized attempts are cleared in one batched write after the
  // loop, so the steady state costs one fund write per pass, not per payout.
  const markersToClear = new Set<string>();

  for (const pendingEntry of pending) {
    // Claim before any fund debit or holder credit. The claim journals the
    // pre-claim status plus a fresh attempt key (#2223); the key ties the
    // fund-side debit marker and the holder-side credit receipt to this
    // attempt, and both markers are written atomically with their money legs.
    // A crash later in this payout is reconciled from those markers, never
    // from the journal alone — which is why journal-less legacy rows stay
    // quarantined for manual reconciliation instead of being replayed blind.
    const claimedAt = new Date();
    const attemptKey = redemptionAttemptKey(pendingEntry._id, claimedAt);
    const entry = await db
      .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
      .findOneAndUpdate(
        {
          _id: pendingEntry._id,
          status: pendingEntry.status,
          units: pendingEntry.units,
          paidAmountAnchor: pendingEntry.paidAmountAnchor,
        },
        {
          $set: {
            status: "processing",
            processingStartedAt: claimedAt,
            processingAttempt: { from: pendingEntry.status, attemptKey },
            updatedAt: new Date(),
          },
        },
        { returnDocument: "before" }
      );
    if (!entry) continue;
    const restoreQueueClaim = async () => {
      await restorePayoutClaim(db, entry._id, entry.status, attemptKey);
    };

    const unitsRemaining = remainingRedemptionUnits(entry);
    if (unitsRemaining <= 0) {
      // No money to move; keyed so a concurrent resolver's outcome wins.
      await db
        .collection<IndexFundRedemptionQueueEntry>(FUND_REDEMPTION_QUEUE_COLLECTION)
        .updateOne(
          { _id: entry._id, status: "processing", "processingAttempt.attemptKey": attemptKey },
          {
            $set: { status: "paid", updatedAt: new Date() },
            $unset: { processingStartedAt: "", processingAttempt: "" },
          }
        );
      continue;
    }

    // Forward pricing. The payout is struck at the fund's CURRENT NAV, never at
    // `requestedNavAnchor` (kept only as the record of what was quoted at
    // request). Honouring a locked price across many turns is what let one
    // GLB50 holder draw 2.46B out of a fund whose assets were falling under
    // them, because their claim stayed fixed in cash terms while everyone
    // else's shrank. A real open-end fund forward-prices for exactly this
    // reason: a redemption spanning several valuation points gets each point's
    // NAV, so the redeemer carries the market like every other holder.
    const redemptionNav = fundState.quotedNav;
    if (!Number.isFinite(redemptionNav) || redemptionNav <= 0) {
      await restoreQueueClaim();
      break;
    }

    const entryObligation = unitsRemaining * redemptionNav;
    if (availableCash < entryObligation && fundState.holdings.length > 0) {
      const liquidity = await sellFundHoldingsForRedemptionCash(
        db,
        fundState,
        entryObligation - availableCash,
        {
          note: "Queued redemption liquidity",
        }
      );
      if (liquidity.liquidityQuarantined) {
        // Fail-closed (#2223): a previous sale may have died mid-leg, so no
        // new sale is raised for this fund until a human clears the journal.
        // The queue below still pays from available cash.
        console.warn(
          `[indexfund-cron] fund ${fund.slug}: liquidity raising quarantined (unreconciled interrupted sale); paying redemptions from cash only`
        );
      }
      fundState = (await getFundById(db, fund._id)) ?? fundState;
      availableCash = fundState.cashAnchor;
    }
    // Bonds are the next line of liquidity: sold to the market pool at its
    // bid, as far as the pool can pay. The only line for a bond fund.
    if (availableCash < entryObligation) {
      bondSaleThresholds ??= await loadTxThresholds(db);
      const bondSale = await sellFundBondHoldingsForCash(
        db,
        fundState,
        entryObligation - availableCash,
        new Date(),
        { turn: currentTurn, thresholds: bondSaleThresholds }
      );
      if (bondSale.proceedsAnchor > 0) {
        fundState = (await getFundById(db, fund._id)) ?? fundState;
        availableCash = fundState.cashAnchor;
      }
    }

    if (availableCash <= 0) {
      await restoreQueueClaim();
      break;
    }

    // Pro-rata gate: never let one entry consume the book while others wait.
    // Measured against cash available now, after any liquidation above.
    const cashForThisEntry = proRataRedemptionCashShare({
      entryUnits: unitsRemaining,
      unservedUnits,
      availableCashAnchor: availableCash,
    });
    unservedUnits = Math.max(0, unservedUnits - unitsRemaining);

    const quote = quoteCashOnlyRedemption({
      quotedNav: redemptionNav,
      requestedUnits: unitsRemaining,
      cashAnchor: cashForThisEntry,
    });

    if (quote.redeemableUnits <= 0) {
      // This entry's pro-rata slice will not buy a whole unit. That says
      // nothing about the next entry, and the genuinely-out-of-cash case
      // already broke out above, so move on rather than starving the queue.
      await restoreQueueClaim();
      continue;
    }

    const paidAmount = quote.paidAmountAnchor;
    // Native-currency equivalent for personal wallet credits (₳ × blended rate).
    // Absent redeemFxRate = pre-fix queue row → credit rate-free (× 1), matching
    // what the holder was owed under the old symmetric-scale code (no windfall).
    const redeemFxRate = entry.redeemFxRate ?? 1;
    const paidNative = forexEnabled ? paidAmount * redeemFxRate : paidAmount;

    // New queue rows burned units at request time; legacy rows burn as they pay.
    const shouldBurnUnitsNow = entry.unitsBurnedAtRequest !== true;
    const debitFilter: Record<string, unknown> = {
      _id: fund._id,
      cashAnchor: { $gte: paidAmount },
    };
    const debitInc: Record<string, number> = { cashAnchor: -paidAmount };
    if (shouldBurnUnitsNow) {
      debitFilter.unitSupply = { $gte: quote.redeemableUnits };
      debitInc.unitSupply = -quote.redeemableUnits;
    }

    // Guarded debit: only pay out if the fund still holds enough cash. Legacy
    // queued rows also require supply because their units were not burned yet.
    // The debit writes its marker atomically (#2223): the marker's presence
    // on the fund document is durable proof the debit landed, and the refund
    // removes it atomically, so every interrupted attempt below resolves from
    // marker/receipt truth and can neither strand fund cash nor double-pay on
    // retry. Each entry is isolated (continue, not break) so one entry's
    // transient failure does not starve the rest of the queue.
    const burnUnits = shouldBurnUnitsNow ? quote.redeemableUnits : 0;
    const remainingAfterPay = quote.queuedUnits;
    const receipt: IndexFundRedemptionReceipt = {
      key: attemptKey,
      amountAnchor: paidAmount,
      units: quote.redeemableUnits,
      remainingUnits: remainingAfterPay,
      nav: redemptionNav,
    };
    const markerPath = debitMarkerPath(attemptKey);

    // Evidence rows (fund transaction, ledger) for a committed payout. Runs
    // only after this attempt's finalize won the conditional write, so a
    // retry or a concurrent resolver can never double-book them; a crash
    // after finalize leaves money and queue state correct with at most a
    // missing audit row.
    const emitPayoutEvidence = async () => {
      await insertFundTransaction(db, {
        fundId: fund._id,
        kind: "redemption",
        holderKind: entry.holderKind,
        characterId: entry.characterId,
        imperialCharacterId: entry.imperialCharacterId,
        nppId: entry.nppId,
        units: quote.redeemableUnits,
        navAnchor: redemptionNav,
        amountAnchor: paidAmount,
        note: "Paid from queued redemption",
        createdAt: new Date(),
      });

      // #992 tranche 6: the NPP credit above moved nppInvestmentCashAnchor, and
      // unlike the character/imperial legs (which logIndexFundRedeem evidences)
      // it had no ledger row, so every queue-paid NPP redemption read as an
      // unexplained NPP inflow. One npp-subject index_fund_redeem row per paid
      // NPP entry, denominated in the NPP home currency from the batched lookup
      // with the ₳ value stated outright. The shadow ledger mirrors the fund
      // cash side off meta when the currencies match (same convention as the
      // NPP subscribe rows); a cross-currency pair stays single-sided under
      // fund_redemption, never guessed. Emitted here, after the queue row and
      // the fund transaction both landed, so a retry can never double-book it.
      if (entry.nppId) {
        const nppCurrency = nppCurrencyById.get(entry.nppId.toString()) ?? "USD";
        await emitTx(db, {
          type: "index_fund_redeem",
          turn: currentTurn,
          createdAt: new Date(),
          subjectType: "npp",
          subjectId: entry.nppId,
          subjectName: `NPP ${entry.nppId.toString()}`,
          amount: paidAmount,
          anchorAmount: paidAmount,
          currencyCode: nppCurrency,
          counterpartyType: "system",
          counterpartyName: fund.name,
          meta: {
            fundId: fund._id.toString(),
            fundCurrency: fund.anchorCurrencyCode,
            units: quote.redeemableUnits,
            source: "cron_queue",
          },
        });
      }

      if (entry.holderKind === "character" || entry.holderKind === "imperial_character") {
        const holder = await resolveIndexFundHolder(db, entry);
        if (holder) {
          void logIndexFundRedeem(db, {
            fund: fundState,
            holder,
            units: quote.redeemableUnits,
            navAnchor: redemptionNav,
            amountAnchor: paidAmount,
            source: "cron_queue",
            queuedRemainder: remainingAfterPay,
            turn: currentTurn,
          });
        }
      }
    };

    let fundDebited = false;
    try {
      const debitResult = await db.collection<IndexFund>("indexFunds").updateOne(
        {
          ...debitFilter,
          [markerPath]: { $exists: false },
        },
        {
          $inc: debitInc,
          $set: {
            [markerPath]: {
              amountAnchor: paidAmount,
              units: burnUnits,
              queueEntryId: entry._id,
              markedAt: new Date(),
            },
            updatedAt: new Date(),
          },
        }
      );
      if (debitResult.matchedCount === 0) {
        await restoreQueueClaim();
        break;
      }
      fundDebited = true;
      availableCash -= paidAmount;

      // Ownership fence before holder money moves: a reaper that claimed this
      // row past the lease already accounted for the debit. Crediting now
      // would mint money, so refund the debit and stand down instead — the
      // reaper owns the row from here.
      if (!(await attemptStillOwnsRow(db, entry._id, attemptKey, claimedAt))) {
        await refundMarkedDebit(db, fund._id, attemptKey, {
          amountAnchor: paidAmount,
          units: burnUnits,
        });
        availableCash += paidAmount;
        continue;
      }

      const holderCredited = await creditRedemptionHolder(
        db,
        entry,
        receipt,
        paidNative,
        paidAmount,
        fundState.anchorCurrencyCode,
        forexEnabled
      );
      if (!holderCredited) {
        // Acknowledged matched-0 under this attempt key (holder gone, or the
        // row carries no holder): the receipt read distinguishes "already
        // paid under this key" (finalize, moving no money) from "never
        // credited" (refund once, then restore). The key is unique per
        // attempt (redemptionAttemptKey carries a random suffix), so a
        // matched-0 proves THIS attempt credited nothing: a receipt under
        // this key cannot predate us. Delete/recreate stays safe too: the
        // recreated doc carries no receipt (reads "absent"), the destroyed
        // credit died with the old doc, and refund-plus-restore replays
        // exactly once. Only an unreadable receipt fails closed (left for
        // the reaper with the debit outstanding as an explicit obligation).
        let seen: HolderReceiptRead;
        try {
          seen = await readHolderReceipt(db, entry, attemptKey);
        } catch {
          seen = { status: "unknown" };
        }
        if (seen.status === "credited") {
          if (
            await finalizePayoutBookkeeping(
              db,
              entry._id,
              attemptKey,
              receipt,
              entry.paidAmountAnchor ?? 0
            )
          ) {
            markersToClear.add(attemptKey);
            await emitPayoutEvidence();
            paid++;
          }
          continue;
        }
        if (seen.status === "unknown") {
          console.warn(
            `[indexfund-cron] redemption payout for ${entry._id.toString()} failed (holder credit unproven with ${paidAmount} anchor debit outstanding; leaving it for the reaper)`
          );
          continue;
        }
        await refundMarkedDebit(db, fund._id, attemptKey, {
          amountAnchor: paidAmount,
          units: burnUnits,
        });
        availableCash += paidAmount;
        await restoreQueueClaim();
        continue;
      }
      // Conditional finalize: a concurrent resolver that already finalized or
      // restored this row wins, and this attempt must not audit twice. A
      // lost race after our credit landed is resolved from durable truth
      // (resolveLostFinalizeRace): the reaper may have refunded the debit
      // while we were stalled, leaving our credit unbacked.
      if (
        !(await finalizePayoutBookkeeping(
          db,
          entry._id,
          attemptKey,
          receipt,
          entry.paidAmountAnchor ?? 0
        ))
      ) {
        await resolveLostFinalizeRace(
          db,
          fund._id,
          entry,
          attemptKey,
          paidNative,
          paidAmount,
          fundState.anchorCurrencyCode,
          forexEnabled,
          quote.redeemableUnits
        );
        continue;
      }
      markersToClear.add(attemptKey);
      await emitPayoutEvidence();
    } catch (payoutError) {
      // Resolve from durable truth; never assume which leg landed. The fund
      // marker says whether the debit is outstanding, the holder receipt says
      // whether the credit landed. Both are written atomically with their
      // money legs, so every branch below converges: refund at most once,
      // credit never twice, restore only when nothing is outstanding.
      const fail = (message: string) =>
        console.warn(
          `[indexfund-cron] redemption payout for ${entry._id.toString()} failed (${message}):`,
          payoutError instanceof Error ? payoutError.message : payoutError
        );
      let marker: DebitMarkerRead;
      try {
        marker = await readDebitMarker(db, fund._id, attemptKey);
      } catch {
        marker = { status: "unknown" };
      }
      if (marker.status === "unknown") {
        // Cannot tell whether the debit landed: leave the journaled row for
        // the reaper, which retries the same truth reads. Do not restore (a
        // replay could double-pay) and do not refund blind (could double-
        // refund against a concurrent resolver).
        fail("fund marker unreadable; leaving it for the reaper");
        continue;
      }
      if (marker.status === "absent" && !fundDebited) {
        // The debit never landed (or a concurrent resolver already refunded
        // it): nothing moved, so the claim is safe to restore.
        try {
          await restoreQueueClaim();
        } catch {
          // Claim restore failed: the row stays journaled `processing` for
          // the reaper rather than being paid twice.
        }
        fail("rolled back before any money moved");
        continue;
      }
      let seen: HolderReceiptRead;
      try {
        seen = await readHolderReceipt(db, entry, attemptKey);
      } catch {
        seen = { status: "unknown" };
      }
      if (seen.status === "credited") {
        // The holder was paid: complete the bookkeeping without moving money.
        // A lost finalize race just skips the evidence rows (at most a
        // missing audit row, never a double-book).
        try {
          if (
            await finalizePayoutBookkeeping(
              db,
              entry._id,
              attemptKey,
              {
                amountAnchor: seen.receipt.amountAnchor,
                remainingUnits: seen.receipt.remainingUnits,
                nav: seen.receipt.nav,
              },
              entry.paidAmountAnchor ?? 0
            )
          ) {
            markersToClear.add(attemptKey);
            await emitPayoutEvidence();
            paid++;
          }
        } catch {
          // Finalize failed: the journaled row stays for the reaper, which
          // finalizes from the same receipt without moving money.
        }
        fail("holder was already paid; finalized without moving money");
        continue;
      }
      if (seen.status === "unknown" || seen.status === "holder-missing") {
        // Ambiguous: with a debit outstanding (or possibly outstanding) the
        // credit may have landed. Fail closed — leave the journaled row for
        // the reaper, which quarantines it for a human. Refunding here could
        // mint money; restoring here could replay a paid entry.
        fail("holder credit ambiguous; leaving it for the reaper");
        continue;
      }
      // Definitive non-credit with the debit outstanding, proven by THIS
      // attempt's own synchronous writes (unique attempt key, so a receipt
      // under this key cannot predate us; the row is fresh, so no reaper
      // could have interleaved past the lease): refund exactly once
      // (marker-atomic: a concurrent refund converges to one) and restore.
      // If the marker is already gone a concurrent resolver refunded, and the
      // refund below is a no-op.
      const refunded =
        marker.status === "present"
          ? await refundMarkedDebit(db, fund._id, attemptKey, {
              amountAnchor: marker.marker.amountAnchor,
              units: marker.marker.units,
            })
          : false;
      if (refunded && marker.status === "present") availableCash += marker.marker.amountAnchor;
      try {
        await restoreQueueClaim();
      } catch {
        // Claim restore failed: the row stays journaled `processing` for the
        // reaper. The debit is already refunded exactly once, so the reaper
        // restores with no money movement.
      }
      fail("refunded and restored");
      continue;
    }

    paid++;
  }

  if (markersToClear.size > 0) {
    const unset: Record<string, ""> = {};
    for (const key of markersToClear) unset[debitMarkerPath(key)] = "";
    await db.collection<IndexFund>("indexFunds").updateOne({ _id: fund._id }, { $unset: unset });
  }

  return paid;
}
