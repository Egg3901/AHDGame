/**
 * Atomic debit + credit for "Send to Member" treasury actions.
 *
 * Extracted from `src/app/api/country/[code]/parties/[id]/send/route.ts`
 * so the same logic runs in both the immediate path (`transactionApproval
 * Mode === "single"`) and the two-person-approval execute step
 * (`.../treasury/pending/[txnId]/approve`). Behavior must stay identical
 * to the legacy immediate path — balance race-protection, replica-set
 * vs standalone Mongo fallback, admin log, treasury audit log,
 * activity log — so existing tests against the immediate path continue
 * to apply.
 *
 * Auth, target lookup, and player-transfers feature gate stay in the
 * route layer (different in each calling context). Reserve breach
 * computation is also up to the caller; pass the warning string (or
 * null) so it shows in the admin log + response message.
 */

import { ObjectId, type ClientSession, type MongoServerError, type UpdateFilter } from "mongodb";
import { NextResponse } from "next/server";
import type { Db } from "mongodb";
import { getMongoClient } from "@/lib/mongodb";
import { runTransactionWithSessionRetry } from "@/lib/db/transactionWithRetry";
import { badRequest, notFound } from "@/lib/api/errors";
import type { AdminLog, Character, PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, getSeedCurrencyCode } from "@/lib/constants/currencies";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { getGameState } from "@/lib/gameState";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { emitTreasuryTransaction } from "@/lib/treasury/emit";
import { checkPlayerPayoutCap } from "@/lib/treasury/payoutCap";
// Imported from the values module, not the re-export on `payoutCap`: it is a
// pure helper with no database dependency, and tests that mock the
// database-facing module should not have to stub it.
import { countDistinctOfficers } from "@/lib/treasury/payoutCapValues";
import { TreasuryExecutionUncertainError } from "@/lib/treasury/executionUncertain";

export interface ExecuteSendToMemberArgs {
  db: Db;
  countryId: CountryId;
  /**
   * Officer seats are included because the recipient's per-turn ceiling
   * rises once two different officers are seated on the paying body.
   */
  party: Pick<
    PoliticalParty,
    "_id" | "name" | "sequentialId" | "treasury" | "chairId" | "viceChairId" | "treasurerId"
  >;
  targetCharacter: Pick<Character, "_id" | "name">;
  amount: number;
  /** Pre-formatted reserve warning, or null. Folded into log + response. */
  reserveWarning: string | null;
  /** The character whose action triggered the execute (proposer in single mode, approver in double mode). */
  initiator: { _id: ObjectId; name: string };
  /** Auth username, for adminLog.adminUsername field. */
  initiatorUsername: string;
  /** Auth userId, for activityLog.userId. */
  initiatorUserId: string;
  /**
   * Current game turn, used for the recipient's per-turn payout cap.
   * Passed in rather than read here so the cap stays testable and the
   * executor keeps no clock dependency of its own.
   */
  currentTurn: number;
  /**
   * Skip the payout cap. Admin actions only — admins already bypass the
   * rest of the treasury workflow.
   */
  skipPayoutCap?: boolean;
}

/**
 * Returns either:
 *   - `{ ok: true, response }` — the route should `return response` (200 JSON)
 *   - `{ ok: false, response }` — the route should `return response` (4xx JSON)
 *
 * Either way the caller can pass `response` straight through.
 */
export async function executeSendToMember(
  args: ExecuteSendToMemberArgs
): Promise<{ ok: boolean; response: NextResponse }> {
  const { db, countryId, party, targetCharacter, amount, reserveWarning, initiator } = args;
  const partyIdStr = String(party.sequentialId);

  // Per-turn ceiling on what one player can receive from party funds.
  // Checked here rather than in the routes so both the direct send and
  // the Request Funds approval path are covered by one guard.
  if (!args.skipPayoutCap) {
    const cap = await checkPlayerPayoutCap(db, {
      characterId: targetCharacter._id,
      countryId,
      currentTurn: args.currentTurn,
      amount,
      seatedOfficers: countDistinctOfficers([
        party.chairId?.toString(),
        party.viceChairId?.toString(),
        party.treasurerId?.toString(),
      ]),
    });
    if (!cap.ok) {
      return { ok: false, response: NextResponse.json({ error: cap.reason }, { status: 400 }) };
    }
  }

  const now = new Date();
  const forexEnabled = await isForexEnabled();
  // Post-Phase-6: party treasury and recipient campaign balance are
  // both in the same local home currency (same country = same currency).
  const recipientFundsField = forexEnabled ? "currencyBalances.campaign" : "funds";
  const partyDebit: UpdateFilter<PoliticalParty> = {
    $inc: { treasury: -amount },
    $set: { updatedAt: now },
  };
  const characterCredit = {
    $inc: { [recipientFundsField]: amount },
  };

  const applyInTransaction = async (session: ClientSession) => {
    const debitResult = await db
      .collection<PoliticalParty>("politicalParties")
      .updateOne({ _id: party._id, treasury: { $gte: amount } }, partyDebit, { session });
    if (debitResult.matchedCount === 0) {
      throw badRequest("Insufficient treasury funds");
    }
    const creditResult = await db
      .collection<Character>("characters")
      .updateOne({ _id: targetCharacter._id }, characterCredit, { session });
    if (creditResult.matchedCount === 0) {
      throw notFound("Character not found");
    }
  };

  const applyWithoutTransaction = async (): Promise<NextResponse | null> => {
    const debitResult = await db
      .collection<PoliticalParty>("politicalParties")
      .updateOne({ _id: party._id, treasury: { $gte: amount } }, partyDebit);
    if (debitResult.matchedCount === 0) {
      return NextResponse.json({ error: "Insufficient treasury funds" }, { status: 400 });
    }
    // The debit has landed and there is no transaction to roll back, so
    // every exit from here on must either complete the credit or put the
    // money back. A THROWN credit was previously not compensated at all:
    // it escaped with the treasury already short, and the approve route
    // read that as "nothing happened" and reopened the row for a second
    // debit.
    const refundDebit = async (reason: string, cause?: unknown): Promise<void> => {
      try {
        await db
          .collection<PoliticalParty>("politicalParties")
          .updateOne(
            { _id: party._id },
            { $inc: { treasury: amount }, $set: { updatedAt: new Date() } }
          );
      } catch (refundError) {
        console.error(
          JSON.stringify({
            error: "treasury_send_refund_failed",
            operation: "execute_send_to_member",
            partyId: partyIdStr,
            countryId,
            amount,
            recipientId: targetCharacter._id.toString(),
            reason,
            message: refundError instanceof Error ? refundError.message : String(refundError),
            // The failure that triggered the refund. Without it an
            // operator reconciling this row sees only that the refund
            // failed, not what went wrong first.
            ...(cause !== undefined && {
              causedBy: cause instanceof Error ? cause.message : String(cause),
            }),
          })
        );
        throw new TreasuryExecutionUncertainError(
          `Treasury debited but neither credited nor refunded (${reason}).`,
          { cause: refundError }
        );
      }
    };

    let creditResult;
    try {
      creditResult = await db
        .collection<Character>("characters")
        .updateOne({ _id: targetCharacter._id }, characterCredit);
    } catch (creditError) {
      await refundDebit("credit threw", creditError);
      throw creditError;
    }
    if (creditResult.matchedCount === 0) {
      await refundDebit("recipient not found");
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }
    return null;
  };

  try {
    // No session (standalone Mongo, probed by the helper) routes to the
    // sequential path, which compensates for partial writes itself.
    const fallbackResponse = await runTransactionWithSessionRetry(
      getMongoClient,
      async (session) => {
        if (!session) return applyWithoutTransaction();
        await applyInTransaction(session);
        return null;
      }
    );
    if (fallbackResponse) {
      return { ok: false, response: fallbackResponse };
    }
  } catch (err) {
    const code = (err as MongoServerError | undefined)?.code;
    if (code === 20 || code === 263) {
      const fallbackResponse = await applyWithoutTransaction();
      if (fallbackResponse) {
        return { ok: false, response: fallbackResponse };
      }
    } else {
      throw err;
    }
  }

  // ─── Audit + activity logs ──────────────────────────────────────────────
  // PAST THIS POINT THE MONEY HAS MOVED. Nothing below may throw: the
  // callers treat an exception as "the transfer did not happen" and
  // unwind accordingly — the two-person approve route hands the
  // approver's signature back, reopening a row whose funds are already
  // gone, which a second Approve click then spends again. A lost audit
  // row is a reporting gap; a thrown audit row was a double payout.
  //
  // Record currency is the world's seed home code, so 2027 euro members
  // stamp EUR. The gameState read resolves failures to the default preset
  // (era-blind map), never to a throw. One read on a user-initiated
  // transfer; nothing on the turn path.
  const txCurrency = await getGameState().then(
    (gameState) => getSeedCurrencyCode(countryId, gameState?.preset ?? DEFAULT_SEED_PRESET),
    () => COUNTRY_CURRENCY_MAP[countryId] ?? "USD"
  );
  const adminLog: AdminLog = {
    _id: new ObjectId(),
    createdAt: now,
    category: "election",
    action: "funds_transferred",
    username: targetCharacter.name,
    adminUsername: args.initiatorUsername,
    details: `Sent $${amount.toLocaleString()} from ${party.name} treasury to ${targetCharacter.name}${
      reserveWarning ? ` (${reserveWarning})` : ""
    }`,
  };
  try {
    await db.collection<AdminLog>("adminLogs").insertOne(adminLog);
  } catch (err) {
    console.error(
      JSON.stringify({
        error: "treasury_send_admin_log_failed",
        operation: "execute_send_to_member",
        partyId: partyIdStr,
        countryId,
        amount,
        recipientId: targetCharacter._id.toString(),
        message: err instanceof Error ? err.message : String(err),
      })
    );
  }

  try {
    await emitTreasuryTransaction({
      db,
      countryId,
      partyId: partyIdStr,
      holderType: "party",
      holderId: partyIdStr,
      category: "transfers",
      direction: "debit",
      amount,
      memo: `Send to ${targetCharacter.name}`,
      counterparty: {
        type: "character",
        id: targetCharacter._id.toString(),
        label: targetCharacter.name,
      },
      initiatedBy: {
        type: "character",
        id: initiator._id.toString(),
        label: initiator.name,
      },
      // Stamp the SAME turn the payout cap was checked against. Left to
      // its fallback the emit re-reads gameState, and getGameTime is cached
      // for 5s, so around a turn boundary the check could count turn N
      // while the row landed in turn N+1 — handing the recipient a second
      // full allowance.
      turn: args.currentTurn,
      now,
      currencyCode: txCurrency,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        error: "treasury_send_emit_failed",
        operation: "execute_send_to_member",
        partyId: partyIdStr,
        countryId,
        amount,
        recipientId: targetCharacter._id.toString(),
        message: err instanceof Error ? err.message : String(err),
      })
    );
  }

  // Fire-and-forget activity log row for the admin activity-tracking view.
  // Guarded like the writes above: `new ObjectId(...)` throws
  // SYNCHRONOUSLY on a malformed id, so even a call that is never
  // awaited can escape this function with the money already moved.
  try {
    void db.collection("activityLog").insertOne({
      type: "fund_event",
      timestamp: now,
      userId: new ObjectId(args.initiatorUserId),
      characterId: initiator._id,
      characterName: initiator.name,
      username: args.initiatorUsername,
      countryId,
      fundEventType: "party_transfer",
      amount,
      currencyCode: txCurrency,
      fromId: party._id,
      fromName: party.name,
      fromType: "party",
      toId: targetCharacter._id,
      toName: targetCharacter.name,
      toType: "character",
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        error: "treasury_send_activity_log_failed",
        operation: "execute_send_to_member",
        partyId: partyIdStr,
        countryId,
        amount,
        recipientId: targetCharacter._id.toString(),
        message: err instanceof Error ? err.message : String(err),
      })
    );
  }

  return {
    ok: true,
    response: NextResponse.json({
      message: `Sent $${amount.toLocaleString()} to ${targetCharacter.name}${
        reserveWarning ? ` ${reserveWarning}` : ""
      }`,
      warning: reserveWarning,
    }),
  };
}
