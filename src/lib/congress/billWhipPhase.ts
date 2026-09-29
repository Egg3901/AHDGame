import type { Bill, BillWhip } from "@/lib/db/types";

type BillWhipPhase = Pick<Bill, "status" | "overrideVotingStartedAt">;
type DatedBillWhip = Pick<BillWhip, "createdAt">;

/**
 * Bills reuse one billWhips target across passage and veto-override ballots.
 * Return the start of the current phase when prior rows must not carry over.
 */
export function getBillWhipWindowStart(bill: BillWhipPhase): Date | undefined {
  return bill.status === "veto_override" ? bill.overrideVotingStartedAt : undefined;
}

/**
 * Physical cleanup is best-effort because the veto status transition cannot be
 * transacted on every deployment. Readers therefore also reject passage whips
 * that predate the current override ballot.
 */
export function isBillWhipInCurrentPhase(bill: BillWhipPhase, whip: DatedBillWhip): boolean {
  const windowStart = getBillWhipWindowStart(bill);
  return !windowStart || whip.createdAt >= windowStart;
}
