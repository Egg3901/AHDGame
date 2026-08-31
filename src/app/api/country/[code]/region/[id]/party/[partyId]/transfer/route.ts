import { NextResponse } from "next/server";
import { type ClientSession, type MongoServerError, type UpdateFilter } from "mongodb";
import { getDb, getMongoClient } from "@/lib/mongodb";
import { runTransactionWithSessionRetry } from "@/lib/db/transactionWithRetry";
import { badRequest, handleRouteError, notFound } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { statePartyTransferSchema } from "@/lib/api/schemas/settings";
import { getPartyBudgetCollection } from "@/lib/db/collections";
import type { StatePartyOrg, PoliticalParty, State } from "@/lib/db/types";
import { findPartyBySequentialId, getStatePartyOrgDocumentId } from "@/lib/db/partyLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { findPartyBudgetForScope } from "@/lib/partyBudgetGuards";
import { wouldTriggerTreasuryReserveOverride } from "@/lib/partyTreasuryPlan";
import { emitTreasuryTransaction } from "@/lib/treasury/emit";
import { isSameCountry } from "@/lib/api/sameCountry";

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string }>;
}

// POST /api/country/[code]/region/[id]/party/[partyId]/transfer — Transfer funds from the state party treasury to the national party
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const stateId = id;

    // Verify authentication
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const authUser = auth.user;

    const parsed = await parseJsonBody(request, statePartyTransferSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { amount } = parsed.data;

    const db = await getDb();

    // Verify state exists
    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    // Verify party exists
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const partyKey = String(party.sequentialId);
    const statePartyKey = getStatePartyOrgDocumentId(stateId, party);
    const stateParty = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .findOne({ _id: statePartyKey });

    if (!stateParty) {
      return NextResponse.json({ error: "State party not found" }, { status: 404 });
    }

    // Check authorization: admin, national chair, state chair, vice chair, or state treasurer
    const isAdmin = authUser.isAdmin;
    const isNationalChair = party.chairId?.equals(authUser.character._id);
    const isStateChair = stateParty.chairId?.equals(authUser.character._id);
    const isStateViceChair = stateParty.viceChairId?.equals(authUser.character._id);
    const isStateTreasurer = stateParty.treasurerId?.equals(authUser.character._id);

    if (!isAdmin && !isNationalChair && !isStateChair && !isStateViceChair && !isStateTreasurer) {
      return NextResponse.json(
        {
          error:
            "Only the state chair, vice chair, treasurer, national chair, or an admin can transfer funds",
        },
        { status: 403 }
      );
    }

    // Defense-in-depth: even if the actor's _id matches a chair/treasurer
    // record, refuse if their character somehow belongs to another country.
    if (!isAdmin && !isSameCountry(authUser.character, { countryId })) {
      return NextResponse.json(
        { error: "You must be a citizen of this country to transfer state party funds" },
        { status: 403 }
      );
    }

    // Check treasury balance
    const treasury = stateParty.treasury ?? 0;
    if (amount > treasury) {
      return NextResponse.json(
        { error: `Insufficient treasury balance. Available: $${treasury.toLocaleString()}` },
        { status: 400 }
      );
    }
    const budgetCollection = await getPartyBudgetCollection();
    const treasuryPlan = await findPartyBudgetForScope(budgetCollection, {
      countryId,
      partyId: partyKey,
      scope: "state",
      stateId,
    });
    const reserveBreach = wouldTriggerTreasuryReserveOverride(treasury, amount, treasuryPlan);
    const reserveWarning =
      reserveBreach && !isStateTreasurer
        ? "Emergency override: transfer pierced the Treasurer reserve target."
        : null;

    const now = new Date();
    const statePartyDebit: UpdateFilter<StatePartyOrg> = {
      $inc: { treasury: -amount },
      $set: { updatedAt: now },
    };
    const nationalPartyCredit: UpdateFilter<PoliticalParty> = {
      $inc: { treasury: amount },
      $set: { updatedAt: now },
    };

    const applyTransferInTransaction = async (session: ClientSession) => {
      const debitResult = await db
        .collection<StatePartyOrg>("statePartyOrg")
        .updateOne({ _id: statePartyKey, treasury: { $gte: amount } }, statePartyDebit, {
          session,
        });

      if (debitResult.matchedCount === 0) {
        throw badRequest(`Insufficient treasury balance. Available: $${treasury.toLocaleString()}`);
      }

      const creditResult = await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne({ _id: party._id }, nationalPartyCredit, { session });

      if (creditResult.matchedCount === 0) {
        throw notFound("Party not found");
      }
    };

    const applyTransferWithoutTransaction = async () => {
      const debitResult = await db
        .collection<StatePartyOrg>("statePartyOrg")
        .updateOne({ _id: statePartyKey, treasury: { $gte: amount } }, statePartyDebit);

      if (debitResult.matchedCount === 0) {
        return NextResponse.json(
          { error: `Insufficient treasury balance. Available: $${treasury.toLocaleString()}` },
          { status: 400 }
        );
      }

      const creditResult = await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne({ _id: party._id }, nationalPartyCredit);

      if (creditResult.matchedCount === 0) {
        await db.collection<StatePartyOrg>("statePartyOrg").updateOne(
          { _id: statePartyKey },
          {
            $inc: { treasury: amount },
            $set: { updatedAt: new Date() },
          }
        );
        return NextResponse.json({ error: "Party not found" }, { status: 404 });
      }

      return null;
    };

    try {
      await runTransactionWithSessionRetry(getMongoClient, async (session) =>
        applyTransferInTransaction(session)
      );
    } catch (err) {
      const code = (err as MongoServerError | undefined)?.code;
      if (code === 20 || code === 263) {
        const fallbackResponse = await applyTransferWithoutTransaction();
        if (fallbackResponse) return fallbackResponse;
      } else {
        throw err;
      }
    }

    // Log the action
    await db.collection("adminLogs").insertOne({
      category: "system",
      action: "funds_transferred",
      username: authUser.username,
      characterName: authUser.character.name,
      adminUsername: isAdmin ? authUser.username : undefined,
      details: `Transferred $${amount.toLocaleString()} from ${state.name} ${party.name} to national treasury${reserveWarning ? ` (${reserveWarning})` : ""}`,
      createdAt: now,
    });

    // Treasury audit log: debit on the state party, credit on the
    // national party.
    await emitTreasuryTransaction({
      db,
      countryId,
      partyId,
      holderType: "state_party",
      holderId: statePartyKey,
      category: "transfers",
      direction: "debit",
      amount,
      memo: `Transfer to ${party.name} national treasury`,
      counterparty: { type: "party", id: partyId, label: party.name },
      now,
    });
    await emitTreasuryTransaction({
      db,
      countryId,
      partyId,
      holderType: "party",
      holderId: partyId,
      category: "transfers",
      direction: "credit",
      amount,
      memo: `Transfer from ${state.name} ${party.name}`,
      counterparty: { type: "state_party", id: statePartyKey, label: state.name },
      now,
    });

    return NextResponse.json({
      success: true,
      message: `Transferred $${amount.toLocaleString()} to ${party.name} national treasury${reserveWarning ? ` ${reserveWarning}` : ""}`,
      warning: reserveWarning,
      amount,
      remainingTreasury: treasury - amount,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
