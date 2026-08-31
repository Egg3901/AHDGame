import type { IndexFundRedemptionQueueEntry } from "@/lib/db/types";

/** Units still owed on a queue entry after prior partial payouts. */
export function remainingRedemptionUnits(
  entry: Pick<IndexFundRedemptionQueueEntry, "units"> &
    Partial<Pick<IndexFundRedemptionQueueEntry, "paidAmountAnchor" | "requestedNavAnchor">>
): number {
  return Math.max(0, Math.floor(entry.units));
}

/** Whether a queue row should be retried by the cron payer. */
export function isRetryableRedemptionEntry(
  entry: Pick<
    IndexFundRedemptionQueueEntry,
    "status" | "units" | "paidAmountAnchor" | "requestedNavAnchor"
  >
): boolean {
  if (entry.status === "paid" || entry.status === "cancelled" || entry.status === "processing") {
    return false;
  }
  return remainingRedemptionUnits(entry) > 0;
}

/**
 * Status after applying a payout against remaining units. Only called after a
 * successful nonzero payout, so "queued" (meaning "never touched") can't apply
 * here — a row that still has units left after being paid down is "partial",
 * not indistinguishable from a fresh, untouched request.
 */
export function redemptionEntryStatusAfterPayout(remainingUnits: number): "paid" | "partial" {
  return remainingUnits <= 0 ? "paid" : "partial";
}
