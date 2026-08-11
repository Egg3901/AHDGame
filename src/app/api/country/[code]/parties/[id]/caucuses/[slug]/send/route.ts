import { NextResponse } from "next/server";
import { ObjectId, type ClientSession, type MongoServerError, type UpdateFilter } from "mongodb";
import { getDb, getMongoClient } from "@/lib/mongodb";
import { badRequest, handleRouteError, notFound } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { sendFundsSchema } from "@/lib/api/schemas/send";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { findCaucusBySlug, listCaucusMemberships } from "@/lib/db/caucusLookup";
import type { Caucus, Character, AdminLog } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { requirePlayerTransfersEnabled } from "@/lib/api/requirePlayerTransfers";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { emitTreasuryTransaction } from "@/lib/treasury/emit";
import { isSameCountry } from "@/lib/api/sameCountry";

interface RouteParams {
  params: Promise<{ code: string; id: string; slug: string }>;
}

// POST /api/country/[code]/parties/[id]/caucuses/[slug]/send — Send caucus funds to an active caucus player member
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId, slug } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(authResult.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const authUser = authResult.user;

    const parsed = await parseJsonBody(request, sendFundsSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { characterId, amount: sendAmount } = parsed.data;
    const targetCharacterOid = new ObjectId(characterId);

    const db = await getDb();
    const transferGuard = await requirePlayerTransfersEnabled(db);
    if (transferGuard) return transferGuard;

    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }
    const partyIdStr = String(party.sequentialId);

    const resolved = await findCaucusBySlug(db, countryId, partyIdStr, slug);
    if (!resolved) {
      return NextResponse.json({ error: "Caucus not found" }, { status: 404 });
    }
    const { caucus } = resolved;

    const isAdmin = authUser.isAdmin;
    const isChair = caucus.chairId?.equals(authUser.character._id) ?? false;
    if (!isAdmin && !isChair) {
      return NextResponse.json(
        { error: "Only the Caucus Chair or an admin can send caucus funds" },
        { status: 403 }
      );
    }
    // Defense-in-depth: chair role retains across relocation, so refuse if the
    // actor's character is no longer in this country.
    if (!isAdmin && !isSameCountry(authUser.character, { countryId })) {
      return NextResponse.json(
        { error: "You must be a citizen of this country to send caucus funds" },
        { status: 403 }
      );
    }

    const memberships = await listCaucusMemberships(db, caucus._id, "character");
    const activeCharacterIds = new Set(
      memberships.map((membership) => membership.memberId.toString())
    );
    if (!activeCharacterIds.has(targetCharacterOid.toString())) {
      return NextResponse.json(
        { error: "Character is not an active player member of this caucus" },
        { status: 400 }
      );
    }

    const targetCharacter = await db.collection<Character>("characters").findOne({
      _id: targetCharacterOid,
      countryId,
      party: partyIdStr,
    });
    if (!targetCharacter) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const treasury = caucus.treasury ?? 0;
    if (treasury < sendAmount) {
      return NextResponse.json({ error: "Insufficient caucus funds" }, { status: 400 });
    }

    const now = new Date();
    const forexEnabled = await isForexEnabled();
    // Post-Phase-6: caucus treasury and recipient campaign balance are both
    // in the same local home currency.
    const recipientFundsField = forexEnabled ? "currencyBalances.campaign" : "funds";
    const caucusDebit: UpdateFilter<Caucus> = {
      $inc: { treasury: -sendAmount },
      $set: { updatedAt: now },
    };
    const characterCredit = {
      $inc: { [recipientFundsField]: sendAmount },
    };

    const applySendInTransaction = async (session: ClientSession) => {
      const debitResult = await db
        .collection<Caucus>("caucuses")
        .updateOne({ _id: caucus._id, treasury: { $gte: sendAmount } }, caucusDebit, { session });

      if (debitResult.matchedCount === 0) {
        throw badRequest("Insufficient caucus funds");
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
        .collection<Caucus>("caucuses")
        .updateOne({ _id: caucus._id, treasury: { $gte: sendAmount } }, caucusDebit);

      if (debitResult.matchedCount === 0) {
        return NextResponse.json({ error: "Insufficient caucus funds" }, { status: 400 });
      }

      const creditResult = await db
        .collection<Character>("characters")
        .updateOne({ _id: targetCharacterOid }, characterCredit);

      if (creditResult.matchedCount === 0) {
        await db.collection<Caucus>("caucuses").updateOne(
          { _id: caucus._id },
          {
            $inc: { treasury: sendAmount },
            $set: { updatedAt: new Date() },
          }
        );
        return NextResponse.json({ error: "Character not found" }, { status: 404 });
      }

      return null;
    };

    const client = await getMongoClient();
    const session = client.startSession();
    try {
      try {
        await session.withTransaction(async () => applySendInTransaction(session));
      } catch (err) {
        const code = (err as MongoServerError | undefined)?.code;
        if (code === 20 || code === 263) {
          const fallbackResponse = await applySendWithoutTransaction();
          if (fallbackResponse) return fallbackResponse;
        } else {
          throw err;
        }
      }
    } finally {
      await session.endSession();
    }

    const adminLog: AdminLog = {
      _id: new ObjectId(),
      createdAt: now,
      category: "election",
      action: "funds_transferred",
      username: targetCharacter.name,
      adminUsername: authUser.username,
      details: `Sent $${sendAmount.toLocaleString()} from caucus ${caucus.name} to ${targetCharacter.name}`,
    };
    await db.collection<AdminLog>("adminLogs").insertOne(adminLog);

    await emitTreasuryTransaction({
      db,
      countryId,
      partyId: partyIdStr,
      holderType: "caucus",
      holderId: caucus._id.toString(),
      category: "transfers",
      direction: "debit",
      amount: sendAmount,
      memo: `Send to ${targetCharacter.name}`,
      counterparty: {
        type: "character",
        id: targetCharacterOid.toString(),
        label: targetCharacter.name,
      },
      initiatedBy: {
        type: "character",
        id: authUser.character._id.toString(),
        label: authUser.character.name,
      },
      now,
    });

    void db.collection("activityLog").insertOne({
      type: "fund_event",
      timestamp: now,
      userId: new ObjectId(authUser.userId),
      characterId: authUser.character._id,
      characterName: authUser.character.name,
      username: authUser.username,
      countryId,
      fundEventType: "caucus_transfer",
      amount: sendAmount,
      currencyCode: COUNTRY_CURRENCY_MAP[countryId] ?? "USD",
      fromId: caucus._id,
      fromName: caucus.name,
      fromType: "caucus",
      toId: targetCharacterOid,
      toName: targetCharacter.name,
      toType: "character",
    });

    return NextResponse.json({
      message: `Sent $${sendAmount.toLocaleString()} to ${targetCharacter.name}`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
