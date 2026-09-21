/**
 * Atomic debit + state-party credit for "Transfer to State Party" treasury
 * actions.
 *
 * Extracted from
 * `src/app/api/country/[code]/parties/[id]/transfer/route.ts` so the
 * same logic runs in both the immediate path (`transactionApprovalMode
 * === "single"`) and the two-person-approval execute step. Behavior
 * mirrors the legacy immediate path — balance race-protection, replica-
 * set vs standalone fallback, admin log, two treasury audit rows
 * (debit on national + credit on state-party), financialTx log entries,
 * activity log — so existing transfer-route tests continue to apply.
 */

import { ObjectId, type ClientSession, type MongoServerError, type UpdateFilter } from "mongodb";
import { NextResponse } from "next/server";
import type { Db } from "mongodb";
import { getMongoClient } from "@/lib/mongodb";
import { runTransactionWithSessionRetry } from "@/lib/db/transactionWithRetry";
import { badRequest } from "@/lib/api/errors";
import type { PoliticalParty, StatePartyOrg, State } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { emitTreasuryTransaction } from "@/lib/treasury/emit";
import { emitTx } from "@/lib/financialTxLog/emit";
import { TreasuryExecutionUncertainError } from "@/lib/treasury/executionUncertain";
import { getGameState } from "@/lib/gameState";

export interface ExecuteTransferToStateArgs {
  db: Db;
  countryId: CountryId;
  party: Pick<PoliticalParty, "_id" | "name" | "sequentialId" | "treasury">;
  state: Pick<State, "_id" | "name">;
  amount: number;
  reserveWarning: string | null;
  initiator: { _id: ObjectId; name: string };
  initiatorUsername: string;
  initiatorUserId: string;
  isAdmin: boolean;
}

export async function executeTransferToStateParty(
  args: ExecuteTransferToStateArgs
): Promise<{ ok: boolean; response: NextResponse }> {
  const { db, countryId, party, state, amount, reserveWarning, initiator } = args;
  const partyIdStr = String(party.sequentialId);
  const upperStateId = String(state._id).toUpperCase();
  const now = new Date();
  const statePartyKey = `${upperStateId}_${partyIdStr}`;
  const treasury = party.treasury ?? 0;

  const partyDebit: UpdateFilter<PoliticalParty> = {
    $inc: { treasury: -amount },
    $set: { updatedAt: now },
  };
  const statePartyCredit = {
    $inc: { treasury: amount },
    $set: { updatedAt: now },
    $setOnInsert: {
      _id: statePartyKey,
      stateId: upperStateId,
      partyId: partyIdStr,
      countryId,
      organization: 0,
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      stateTaxRate: 0,
      politicalStrength: 0,
      hasPresence: false,
      createdAt: now,
    },
  };

  const applyInTransaction = async (session: ClientSession) => {
    const debitResult = await db
      .collection<PoliticalParty>("politicalParties")
      .updateOne({ _id: party._id, treasury: { $gte: amount } }, partyDebit, { session });
    if (debitResult.matchedCount === 0) {
      throw badRequest(`Insufficient treasury balance. Available: $${treasury.toLocaleString()}`);
    }
    await db
      .collection<StatePartyOrg>("statePartyOrg")
      .updateOne({ _id: statePartyKey }, statePartyCredit, { upsert: true, session });
  };

  const applyWithoutTransaction = async (): Promise<NextResponse | null> => {
    const debitResult = await db
      .collection<PoliticalParty>("politicalParties")
      .updateOne({ _id: party._id, treasury: { $gte: amount } }, partyDebit);
    if (debitResult.matchedCount === 0) {
      return NextResponse.json(
        { error: `Insufficient treasury balance. Available: $${treasury.toLocaleString()}` },
        { status: 400 }
      );
    }
    try {
      await db
        .collection<StatePartyOrg>("statePartyOrg")
        .updateOne({ _id: statePartyKey }, statePartyCredit, { upsert: true });
    } catch (error) {
      // Refund on failure. If the refund ALSO fails the treasury is
      // short with nothing credited, and this can no longer be reported
      // as an ordinary refusal: the approve route would hand the
      // signature back and reopen the row for a second debit.
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
            error: "treasury_state_transfer_refund_failed",
            operation: "execute_transfer_to_state_party",
            partyId: partyIdStr,
            countryId,
            stateId: upperStateId,
            amount,
            message: refundError instanceof Error ? refundError.message : String(refundError),
            // The credit failure that triggered the refund. Without it
            // an operator reconciling this row sees only that the refund
            // failed, not what went wrong first.
            causedBy: error instanceof Error ? error.message : String(error),
          })
        );
        throw new TreasuryExecutionUncertainError(
          "Treasury debited but the state party was neither credited nor refunded.",
          { cause: refundError }
        );
      }
      throw error;
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
    if (fallbackResponse) return { ok: false, response: fallbackResponse };
  } catch (err) {
    const code = (err as MongoServerError | undefined)?.code;
    if (code === 20 || code === 263) {
      const fallbackResponse = await applyWithoutTransaction();
      if (fallbackResponse) return { ok: false, response: fallbackResponse };
    } else {
      throw err;
    }
  }

  // ─── Audit + activity logs ──────────────────────────────────────────────
  // PAST THIS POINT THE MONEY HAS MOVED: the national treasury is
  // debited and the state party credited. Nothing below may throw —
  // callers read an exception as "the transfer did not happen", and
  // the two-person approve route responds by handing the approver's
  // signature back, reopening a row whose funds are already gone for a
  // second Approve click to spend again. Losing an audit row is a
  // reporting gap; throwing one was a double payout.
  try {
    await db.collection("adminLogs").insertOne({
      category: "system",
      action: "funds_transferred",
      username: args.initiatorUsername,
      characterName: initiator.name,
      adminUsername: args.isAdmin ? args.initiatorUsername : undefined,
      details: `Transferred $${amount.toLocaleString()} from ${party.name} national treasury to ${state.name}${
        reserveWarning ? ` (${reserveWarning})` : ""
      }`,
      createdAt: now,
    });

    await emitTreasuryTransaction({
      db,
      countryId,
      partyId: partyIdStr,
      holderType: "party",
      holderId: partyIdStr,
      category: "transfers",
      direction: "debit",
      amount,
      memo: `Transfer to ${state.name} state party`,
      counterparty: { type: "state_party", id: statePartyKey, label: state.name },
      initiatedBy: {
        type: "character",
        id: initiator._id.toString(),
        label: initiator.name,
      },
      now,
    });
    await emitTreasuryTransaction({
      db,
      countryId,
      partyId: partyIdStr,
      holderType: "state_party",
      holderId: statePartyKey,
      category: "transfers",
      direction: "credit",
      amount,
      memo: `Transfer from ${party.name} national treasury`,
      counterparty: { type: "party", id: partyIdStr, label: party.name },
      initiatedBy: {
        type: "character",
        id: initiator._id.toString(),
        label: initiator.name,
      },
      now,
    });

    const gameState = await getGameState();
    const txCurrency = (COUNTRY_CURRENCY_MAP[countryId as keyof typeof COUNTRY_CURRENCY_MAP] ??
      "USD") as CurrencyCode;
    void emitTx(db, {
      type: "party_transfer",
      turn: gameState?.currentTurn ?? 0,
      createdAt: now,
      subjectType: "party",
      subjectName: party.name,
      amount: -amount,
      currencyCode: txCurrency,
      counterpartyType: "party",
      counterpartyName: `${state.name} state party`,
      meta: {
        partyId: String(party._id),
        statePartyKey,
        stateId: upperStateId,
        countryId,
        side: "national_outflow",
      },
    });
    void emitTx(db, {
      type: "party_transfer",
      turn: gameState?.currentTurn ?? 0,
      createdAt: now,
      subjectType: "party",
      subjectName: `${state.name} state party`,
      amount,
      currencyCode: txCurrency,
      counterpartyType: "party",
      counterpartyName: party.name,
      meta: {
        partyId: String(party._id),
        statePartyKey,
        stateId: upperStateId,
        countryId,
        side: "state_inflow",
      },
    });

    void db.collection("activityLog").insertOne({
      type: "fund_event",
      timestamp: new Date(),
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
      toId: party._id, // statePartyOrg has no ObjectId; use national party _id as proxy
      toName: `${state.name} ${party.name}`,
      toType: "party",
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        error: "treasury_state_transfer_audit_failed",
        operation: "execute_transfer_to_state_party",
        partyId: partyIdStr,
        countryId,
        stateId: upperStateId,
        amount,
        message: err instanceof Error ? err.message : String(err),
      })
    );
  }

  return {
    ok: true,
    response: NextResponse.json({
      success: true,
      message: `Transferred $${amount.toLocaleString()} to ${state.name} ${party.name}${
        reserveWarning ? ` ${reserveWarning}` : ""
      }`,
      warning: reserveWarning,
      amount,
      remainingTreasury: treasury - amount,
    }),
  };
}
