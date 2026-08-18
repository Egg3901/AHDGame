/**
 * Admin-only escape hatch for a stuck private-banking world.
 *
 * Flag-off (`privateBankingEnabled: false`) is a read-only freeze: pages still
 * render, no player action is accepted, and nothing unwinds. This module is the
 * operator recovery tool that still works with the flag off.
 *
 * Unwind is now a thin wrapper over `revokeCharter`, which runs the shared
 * deposit-book waterfall: pointers back to the central bank, household deposits
 * back into the money supply out of the bank's own cash, insurance behind any
 * shortfall, and only the residual above the household book to the owner.
 *
 * Outstanding player loans are LEFT IN PLACE. They keep amortizing through
 * bankingTurn; the bank corporation still receives payments as a normal corp.
 * Do not invent loan forgiveness here.
 */

import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { revokeCharter } from "@/lib/banking/charter";

export type UnwindBankResult =
  | {
      ok: true;
      alreadyRevoked: boolean;
      depositorsFlipped: number;
      npcDepositsReturned: number;
      refundedCapital: number;
    }
  | { ok: false; error: string };

/**
 * Force-unwind a private bank: flip every depositor pointer for the charter
 * currency back to "centralBank", return npcDeposits to externalBroadMoney,
 * zero deposit aggregates, then revoke (refunding posted capital) and archive.
 *
 * Idempotent: a corp with no active charter returns ok with alreadyRevoked.
 * Does not consult privateBankingEnabled.
 */
export async function unwindBank(
  db: Db,
  corporationId: ObjectId,
  reason: string
): Promise<UnwindBankResult> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    return { ok: false, error: "Reason is required" };
  }

  const corporation = await db.collection<Corporation>("corporations").findOne({
    _id: corporationId,
  });
  if (!corporation) {
    return { ok: false, error: "Corporation not found" };
  }

  const charter = corporation.bankCharter;
  if (!charter || charter.status !== "active") {
    return {
      ok: true,
      alreadyRevoked: true,
      depositorsFlipped: 0,
      npcDepositsReturned: 0,
      refundedCapital: 0,
    };
  }

  // Everything the unwind used to do by hand is the shared waterfall's job now.
  // The hand-rolled version credited the central bank's money pool with the
  // household book, left the matching cash in the bank, and then let
  // `revokeCharter` hand that same cash to the shareholder as a refund. The
  // deposit book existed twice and the owner was paid out of it.
  //
  // `revokeCharter` runs the waterfall itself, so calling it is the whole job.
  const npcDeposits = Math.max(0, charter.npcDeposits ?? 0);

  const revokeReason = `admin unwind: ${trimmedReason}`;
  const revoked = await revokeCharter(db, corporationId, revokeReason);
  if (!revoked.ok) {
    // Race: another path revoked between our clear and revoke. Treat as done.
    if (revoked.error === "Corporation has no active bank charter") {
      return {
        ok: true,
        alreadyRevoked: true,
        depositorsFlipped: 0,
        npcDepositsReturned: npcDeposits,
        refundedCapital: 0,
      };
    }
    return { ok: false, error: revoked.error };
  }

  return {
    ok: true,
    alreadyRevoked: false,
    depositorsFlipped: revoked.depositorsFlipped,
    npcDepositsReturned: npcDeposits,
    refundedCapital: revoked.refundedCapital,
  };
}
