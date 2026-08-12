/**
 * Admin-only escape hatch for a stuck private-banking world.
 *
 * Flag-off (`privateBankingEnabled: false`) is a read-only freeze: pages still
 * render, no player action is accepted, and nothing unwinds. This module is the
 * operator recovery tool that still works with the flag off.
 *
 * Unwind returns depositors to the central bank (pointer flip only; balances
 * untouched), returns NPC deposits to the CB externalBroadMoney pool with
 * conservation, then revokes the charter (refunding postedCapital because
 * deposits are cleared first) and archives via revokeCharter / archiveCharter.
 *
 * Outstanding player loans are LEFT IN PLACE. They keep amortizing through
 * bankingTurn; the bank corporation still receives payments as a normal corp.
 * Do not invent loan forgiveness here.
 */

import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { Character } from "@/lib/db/types/character";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
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

  const currency = charter.currency as CurrencyCode;
  const bankIdHex = corporationId.toString();
  const holderPath = `currencyBalances.savingsHolder.${currency}`;
  const now = new Date();

  // Pointer-only: never touch currencyBalances.savings.<CODE>.
  const flipResult = await db.collection<Character>("characters").updateMany(
    { [holderPath]: bankIdHex },
    {
      $set: {
        [holderPath]: "centralBank",
        updatedAt: now,
      },
    }
  );
  const depositorsFlipped = flipResult.modifiedCount ?? 0;

  const npcDeposits = Math.max(0, charter.npcDeposits ?? 0);
  if (npcDeposits > 0) {
    const bankId = getBankId(getCountryIdForCurrency(currency));
    await db.collection<CentralBank>("centralBanks").updateOne(
      { _id: bankId },
      {
        $inc: { externalBroadMoney: npcDeposits },
        $set: { updatedAt: now },
      }
    );
  }

  // Clear deposit aggregates so revokeCharter refunds postedCapital. Loans stay.
  await db.collection<Corporation>("corporations").updateOne(
    { _id: corporationId, "bankCharter.status": "active" },
    {
      $set: {
        "bankCharter.npcDeposits": 0,
        "bankCharter.totalDeposits": 0,
        updatedAt: now,
      },
    }
  );

  const revokeReason = `admin unwind: ${trimmedReason}`;
  const revoked = await revokeCharter(db, corporationId, revokeReason);
  if (!revoked.ok) {
    // Race: another path revoked between our clear and revoke. Treat as done.
    if (revoked.error === "Corporation has no active bank charter") {
      return {
        ok: true,
        alreadyRevoked: true,
        depositorsFlipped,
        npcDepositsReturned: npcDeposits,
        refundedCapital: 0,
      };
    }
    return { ok: false, error: revoked.error };
  }

  return {
    ok: true,
    alreadyRevoked: false,
    depositorsFlipped,
    npcDepositsReturned: npcDeposits,
    refundedCapital: revoked.refundedCapital,
  };
}
