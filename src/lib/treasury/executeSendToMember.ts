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
import { badRequest, notFound } from "@/lib/api/errors";
import type { AdminLog, Character, PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { emitTreasuryTransaction } from "@/lib/treasury/emit";

export interface ExecuteSendToMemberArgs {
  db: Db;
  countryId: CountryId;
  party: Pick<PoliticalParty, "_id" | "name" | "sequentialId" | "treasury">;
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
    const creditResult = await db
      .collection<Character>("characters")
      .updateOne({ _id: targetCharacter._id }, characterCredit);
    if (creditResult.matchedCount === 0) {
      // Refund the debit so we don't lose treasury funds.
      await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne(
          { _id: party._id },
          { $inc: { treasury: amount }, $set: { updatedAt: new Date() } }
        );
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }
    return null;
  };

  const client = await getMongoClient();
  const session = client.startSession();
  try {
    try {
      await session.withTransaction(async () => applyInTransaction(session));
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
  } finally {
    await session.endSession();
  }

  // ─── Audit + activity logs ──────────────────────────────────────────────
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
  await db.collection<AdminLog>("adminLogs").insertOne(adminLog);

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
    now,
  });

  // Fire-and-forget activity log row for the admin activity-tracking view.
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
    currencyCode: COUNTRY_CURRENCY_MAP[countryId] ?? "USD",
    fromId: party._id,
    fromName: party.name,
    fromType: "party",
    toId: targetCharacter._id,
    toName: targetCharacter.name,
    toType: "character",
  });

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
