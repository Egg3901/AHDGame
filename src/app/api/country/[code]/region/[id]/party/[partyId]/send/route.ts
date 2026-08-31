import { NextResponse } from "next/server";
import { ObjectId, type ClientSession, type MongoServerError, type UpdateFilter } from "mongodb";
import { getDb, getMongoClient } from "@/lib/mongodb";
import { runTransactionWithSessionRetry } from "@/lib/db/transactionWithRetry";
import { requireAuth } from "@/lib/api/requireAuth";
import { badRequest, handleRouteError, notFound } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseObjectId } from "@/lib/utils/objectId";
import { parseJsonBody } from "@/lib/api/validate";
import { sendFundsSchema } from "@/lib/api/schemas/send";
import type { StatePartyOrg, Character, AdminLog } from "@/lib/db/types";
import {
  findPartyBySequentialId,
  getPartyIdString,
  getStatePartyOrgDocumentId,
} from "@/lib/db/partyLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { requirePlayerTransfersEnabled } from "@/lib/api/requirePlayerTransfers";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getPartyBudgetCollection } from "@/lib/db/collections";
import { findPartyBudgetForScope } from "@/lib/partyBudgetGuards";
import { wouldTriggerTreasuryReserveOverride } from "@/lib/partyTreasuryPlan";
import { emitTreasuryTransaction } from "@/lib/treasury/emit";
import { isSameCountry } from "@/lib/api/sameCountry";

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string }>;
}

// POST /api/country/[code]/region/[id]/party/[partyId]/send — Send funds from the state party treasury to a member character
// Auth: requireAuth
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const stateId = id;

    const auth = await requireAuth();
    if (!auth.ok) return auth.response;
    const authUser = auth.user;

    const rateLimit = checkRateLimit(authUser.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, sendFundsSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { characterId, amount: sendAmount } = parsed.data;
    const targetCharacterOid = parseObjectId(characterId);
    if (!targetCharacterOid) {
      return NextResponse.json({ error: "Invalid character ID" }, { status: 400 });
    }

    const db = await getDb();
    const transferGuard = await requirePlayerTransfersEnabled(db);
    if (transferGuard) return transferGuard;

    // Verify party exists
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const partyKey = getPartyIdString(party);
    const statePartyKey = getStatePartyOrgDocumentId(stateId, party);
    const statePartyOrg = await db.collection<StatePartyOrg>("statePartyOrg").findOne({
      _id: statePartyKey,
    });

    if (!statePartyOrg) {
      return NextResponse.json({ error: "State party not found" }, { status: 404 });
    }

    // Check authorization: admin, national chair, state chair, vice chair, or state treasurer
    const isAdmin = authUser.isAdmin;
    const isNationalChair =
      authUser.character && party.chairId?.toString() === authUser.character._id.toString();
    const isStateChair =
      authUser.character && statePartyOrg.chairId?.toString() === authUser.character._id.toString();
    const isStateViceChair =
      authUser.character &&
      statePartyOrg.viceChairId?.toString() === authUser.character._id.toString();
    const isStateTreasurer =
      authUser.character &&
      statePartyOrg.treasurerId?.toString() === authUser.character._id.toString();

    if (!isAdmin && !isNationalChair && !isStateChair && !isStateViceChair && !isStateTreasurer) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Defense-in-depth: even with a matching role _id, refuse if the actor's
    // character belongs to another country (mismatched/inconsistent data).
    if (!isAdmin && authUser.character && !isSameCountry(authUser.character, { countryId })) {
      return NextResponse.json(
        { error: "You must be a citizen of this country to send state party funds" },
        { status: 403 }
      );
    }

    // Verify target character exists and is a member of this state party
    const targetCharacter = await db.collection<Character>("characters").findOne({
      _id: targetCharacterOid,
    });

    if (!targetCharacter) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    if (
      targetCharacter.party !== partyKey ||
      targetCharacter.homeState !== stateId ||
      !isSameCountry(targetCharacter, { countryId })
    ) {
      return NextResponse.json(
        { error: "Character is not a member of this state party" },
        { status: 400 }
      );
    }

    // Check treasury balance
    const treasury = statePartyOrg.treasury ?? 0;
    if (treasury < sendAmount) {
      return NextResponse.json({ error: "Insufficient treasury funds" }, { status: 400 });
    }
    const budgetCollection = await getPartyBudgetCollection();
    const treasuryPlan = await findPartyBudgetForScope(budgetCollection, {
      countryId,
      partyId: partyKey,
      scope: "state",
      stateId,
    });
    const reserveBreach = wouldTriggerTreasuryReserveOverride(treasury, sendAmount, treasuryPlan);
    const reserveWarning =
      reserveBreach && !isStateTreasurer
        ? "Emergency override: send pierced the Treasurer reserve target."
        : null;

    const now = new Date();
    const forexEnabled = await isForexEnabled();
    // Post-Phase-6: state-party treasury and recipient campaign balance are
    // both in the same local home currency.
    const recipientFundsField = forexEnabled ? "currencyBalances.campaign" : "funds";
    const statePartyDebit: UpdateFilter<StatePartyOrg> = {
      $inc: { treasury: -sendAmount },
      $set: { updatedAt: now },
    };
    const characterCredit = {
      $inc: { [recipientFundsField]: sendAmount },
    };

    const applySendInTransaction = async (session: ClientSession) => {
      const debitResult = await db
        .collection<StatePartyOrg>("statePartyOrg")
        .updateOne({ _id: statePartyKey, treasury: { $gte: sendAmount } }, statePartyDebit, {
          session,
        });

      if (debitResult.matchedCount === 0) {
        throw badRequest("Insufficient treasury funds");
      }

      const creditResult = await db
        .collection<Character>("characters")
        .updateOne({ _id: targetCharacterOid }, characterCredit, { session });

      if (creditResult.matchedCount === 0) {
        throw notFound("Character not found");
      }
    };

    const applySendWithoutTransaction = async () => {
      const debitResult = await db
        .collection<StatePartyOrg>("statePartyOrg")
        .updateOne({ _id: statePartyKey, treasury: { $gte: sendAmount } }, statePartyDebit);

      if (debitResult.matchedCount === 0) {
        return NextResponse.json({ error: "Insufficient treasury funds" }, { status: 400 });
      }

      const creditResult = await db
        .collection<Character>("characters")
        .updateOne({ _id: targetCharacterOid }, characterCredit);

      if (creditResult.matchedCount === 0) {
        await db.collection<StatePartyOrg>("statePartyOrg").updateOne(
          { _id: statePartyKey },
          {
            $inc: { treasury: sendAmount },
            $set: { updatedAt: new Date() },
          }
        );
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
          if (!session) return applySendWithoutTransaction();
          await applySendInTransaction(session);
          return null;
        }
      );
      if (fallbackResponse) return fallbackResponse;
    } catch (err) {
      const code = (err as MongoServerError | undefined)?.code;
      if (code === 20 || code === 263) {
        const fallbackResponse = await applySendWithoutTransaction();
        if (fallbackResponse) return fallbackResponse;
      } else {
        throw err;
      }
    }

    // Log the action
    const adminLog: AdminLog = {
      _id: new ObjectId(),
      createdAt: now,
      category: "election",
      action: "funds_transferred",
      username: targetCharacter.name,
      adminUsername: authUser.username,
      details: `Sent $${sendAmount.toLocaleString()} from ${stateId} ${party.name} treasury to ${targetCharacter.name}${reserveWarning ? ` (${reserveWarning})` : ""}`,
    };
    await db.collection<AdminLog>("adminLogs").insertOne(adminLog);

    await emitTreasuryTransaction({
      db,
      countryId,
      partyId,
      holderType: "state_party",
      holderId: statePartyKey,
      category: "transfers",
      direction: "debit",
      amount: sendAmount,
      memo: `Send to ${targetCharacter.name}`,
      counterparty: {
        type: "character",
        id: targetCharacterOid.toString(),
        label: targetCharacter.name,
      },
      now,
    });

    // Fire-and-forget: log fund flow for admin activity tracking
    if (authUser.character) {
      void db.collection("activityLog").insertOne({
        type: "fund_event",
        timestamp: now,
        userId: new ObjectId(authUser.userId),
        characterId: authUser.character._id,
        characterName: authUser.character.name,
        username: authUser.username,
        countryId,
        fundEventType: "party_transfer",
        amount: sendAmount,
        currencyCode: COUNTRY_CURRENCY_MAP[countryId] ?? "USD",
        fromId: party._id, // statePartyOrg has no ObjectId; use national party _id as proxy
        fromName: `${stateId} ${party.name}`,
        fromType: "party",
        toId: targetCharacterOid,
        toName: targetCharacter.name,
        toType: "character",
      });
    }

    return NextResponse.json({
      message: `Sent $${sendAmount.toLocaleString()} to ${targetCharacter.name}${reserveWarning ? ` ${reserveWarning}` : ""}`,
      warning: reserveWarning,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
