import { NextResponse } from "next/server";
import { ObjectId, type ClientSession, type MongoServerError, type UpdateFilter } from "mongodb";
import { getDb, getMongoClient } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { badRequest, handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { statePartyTransferSchema } from "@/lib/api/schemas/settings";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { findCaucusBySlug } from "@/lib/db/caucusLookup";
import type { Caucus, PoliticalParty } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { requirePlayerTransfersEnabled } from "@/lib/api/requirePlayerTransfers";
import { emitTreasuryTransaction } from "@/lib/treasury/emit";
import { isSameCountry } from "@/lib/api/sameCountry";

interface RouteParams {
  params: Promise<{ code: string; id: string; slug: string }>;
}

// POST /api/country/[code]/parties/[id]/caucuses/[slug]/transfer — Transfer caucus funds to the parent national party treasury
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

    const parsed = await parseJsonBody(request, statePartyTransferSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { amount } = parsed.data;

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
        { error: "Only the Caucus Chair or an admin can transfer caucus funds" },
        { status: 403 }
      );
    }
    // Defense-in-depth: chair role retains across relocation, so refuse if the
    // actor's character is no longer in this country.
    if (!isAdmin && !isSameCountry(authUser.character, { countryId })) {
      return NextResponse.json(
        { error: "You must be a citizen of this country to transfer caucus funds" },
        { status: 403 }
      );
    }

    const treasury = caucus.treasury ?? 0;
    if (amount > treasury) {
      return NextResponse.json(
        { error: `Insufficient caucus funds. Available: $${treasury.toLocaleString()}` },
        { status: 400 }
      );
    }

    const now = new Date();
    const caucusDebit: UpdateFilter<Caucus> = {
      $inc: { treasury: -amount },
      $set: { updatedAt: now },
    };
    const partyCredit: UpdateFilter<PoliticalParty> = {
      $inc: { treasury: amount },
      $set: { updatedAt: now },
    };

    const applyTransferInTransaction = async (session: ClientSession) => {
      const debitResult = await db
        .collection<Caucus>("caucuses")
        .updateOne({ _id: caucus._id, treasury: { $gte: amount } }, caucusDebit, { session });

      if (debitResult.matchedCount === 0) {
        throw badRequest(`Insufficient caucus funds. Available: $${treasury.toLocaleString()}`);
      }

      await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne({ _id: party._id }, partyCredit, { session });
    };

    const applyTransferWithoutTransaction = async () => {
      const debitResult = await db
        .collection<Caucus>("caucuses")
        .updateOne({ _id: caucus._id, treasury: { $gte: amount } }, caucusDebit);

      if (debitResult.matchedCount === 0) {
        return NextResponse.json(
          { error: `Insufficient caucus funds. Available: $${treasury.toLocaleString()}` },
          { status: 400 }
        );
      }

      try {
        await db
          .collection<PoliticalParty>("politicalParties")
          .updateOne({ _id: party._id }, partyCredit);
      } catch (error) {
        await db.collection<Caucus>("caucuses").updateOne(
          { _id: caucus._id },
          {
            $inc: { treasury: amount },
            $set: { updatedAt: new Date() },
          }
        );
        throw error;
      }

      return null;
    };

    const client = await getMongoClient();
    const session = client.startSession();
    try {
      try {
        await session.withTransaction(async () => applyTransferInTransaction(session));
      } catch (err) {
        const code = (err as MongoServerError | undefined)?.code;
        if (code === 20 || code === 263) {
          const fallbackResponse = await applyTransferWithoutTransaction();
          if (fallbackResponse) return fallbackResponse;
        } else {
          throw err;
        }
      }
    } finally {
      await session.endSession();
    }

    await db.collection("adminLogs").insertOne({
      category: "system",
      action: "funds_transferred",
      username: authUser.username,
      characterName: authUser.character.name,
      adminUsername: isAdmin ? authUser.username : undefined,
      details: `Transferred $${amount.toLocaleString()} from caucus ${caucus.name} to ${party.name} national treasury`,
      createdAt: now,
    });

    await emitTreasuryTransaction({
      db,
      countryId,
      partyId: partyIdStr,
      holderType: "caucus",
      holderId: caucus._id.toString(),
      category: "transfers",
      direction: "debit",
      amount,
      memo: `Transfer to ${party.name} national treasury`,
      counterparty: { type: "party", id: partyIdStr, label: party.name },
      initiatedBy: {
        type: "character",
        id: authUser.character._id.toString(),
        label: authUser.character.name,
      },
      now,
    });
    await emitTreasuryTransaction({
      db,
      countryId,
      partyId: partyIdStr,
      holderType: "party",
      holderId: partyIdStr,
      category: "transfers",
      direction: "credit",
      amount,
      memo: `Transfer from caucus ${caucus.name}`,
      counterparty: { type: "caucus", id: caucus._id.toString(), label: caucus.name },
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
      amount,
      currencyCode: COUNTRY_CURRENCY_MAP[countryId] ?? "USD",
      fromId: caucus._id,
      fromName: caucus.name,
      fromType: "caucus",
      toId: party._id,
      toName: party.name,
      toType: "party",
    });

    return NextResponse.json({
      success: true,
      message: `Transferred $${amount.toLocaleString()} to ${party.name}`,
      amount,
      remainingTreasury: treasury - amount,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
