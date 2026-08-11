import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { partyDonateSchema } from "@/lib/api/schemas/settings";
import type { StatePartyOrg, Character, State } from "@/lib/db/types";
import {
  findPartyBySequentialId,
  getPartyIdString,
  getStatePartyOrgDocumentId,
} from "@/lib/db/partyLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { isBannedParty } from "@/lib/turn/onePartyConstraints";
import { getCountryState } from "@/lib/countryState";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { requirePlayerTransfersEnabled } from "@/lib/api/requirePlayerTransfers";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { localCampaignBalance } from "@/lib/currency/campaignBalance";
import { emitTreasuryTransaction } from "@/lib/treasury/emit";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { isSameCountry } from "@/lib/api/sameCountry";

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string }>;
}

// POST /api/country/[code]/region/[id]/party/[partyId]/donate — Donate personal funds to the state party treasury
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

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const authUser = auth.user;

    const parsed = await parseJsonBody(request, partyDonateSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { amount } = parsed.data;

    const db = await getDb();
    const transferGuard = await requirePlayerTransfersEnabled(db);
    if (transferGuard) return transferGuard;

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

    // One-party-state guard: banned parties cannot accept donations.
    // Runtime governmentType so a post-Stage-4 conversion lifts the
    // restriction immediately.
    const runtime = await getCountryState(db, countryId);
    if (isBannedParty({ governmentType: runtime.governmentType }, party)) {
      return NextResponse.json(
        { error: "Banned parties cannot accept donations." },
        { status: 403 }
      );
    }

    const partyKey = getPartyIdString(party);
    const statePartyKey = getStatePartyOrgDocumentId(stateId, party);
    const stateParty = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .findOne({ _id: statePartyKey });

    if (!stateParty) {
      return NextResponse.json({ error: "State party not found" }, { status: 404 });
    }

    // Check authorization: must be a member of this state party
    const [character, forexEnabled] = await Promise.all([
      db.collection<Character>("characters").findOne({ _id: authUser.character._id }),
      isForexEnabled(),
    ]);

    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    if (
      character.party !== partyKey ||
      character.homeState !== stateId ||
      !isSameCountry(character, { countryId })
    ) {
      return NextResponse.json(
        { error: "You must be a member of this state party to donate" },
        { status: 403 }
      );
    }

    // Post-Phase-6: amount, character balance, and state-party treasury are
    // all in the same local home currency (same country = same currency).
    const balanceLocal = localCampaignBalance(character, forexEnabled);
    if (amount > balanceLocal) {
      return NextResponse.json(
        { error: `Insufficient funds. Available: $${balanceLocal.toLocaleString()}` },
        { status: 400 }
      );
    }

    const now = new Date();
    const campaignFundsField = forexEnabled ? "currencyBalances.campaign" : "funds";

    await runWithOptionalTransaction(
      async (session) => {
        const debitResult = await db.collection<Character>("characters").updateOne(
          { _id: authUser.character._id, [campaignFundsField]: { $gte: amount } },
          {
            $inc: { [campaignFundsField]: -amount },
            $set: { updatedAt: now },
          },
          { session }
        );

        if (debitResult.modifiedCount === 0) {
          throw new Error("STATE_PARTY_DONATION_FUNDS_CHANGED");
        }

        const creditResult = await db
          .collection<StatePartyOrg>("statePartyOrg")
          .updateOne(
            { _id: statePartyKey },
            { $inc: { treasury: amount }, $set: { updatedAt: now } },
            { session }
          );

        if (creditResult.modifiedCount === 0) {
          throw new Error("STATE_PARTY_DONATION_TARGET_MISSING");
        }
      },
      async () => {
        const debitResult = await db.collection<Character>("characters").updateOne(
          { _id: authUser.character._id, [campaignFundsField]: { $gte: amount } },
          {
            $inc: { [campaignFundsField]: -amount },
            $set: { updatedAt: now },
          }
        );

        if (debitResult.modifiedCount === 0) {
          throw new Error("STATE_PARTY_DONATION_FUNDS_CHANGED");
        }

        try {
          const creditResult = await db
            .collection<StatePartyOrg>("statePartyOrg")
            .updateOne(
              { _id: statePartyKey },
              { $inc: { treasury: amount }, $set: { updatedAt: now } }
            );

          if (creditResult.modifiedCount === 0) {
            throw new Error("STATE_PARTY_DONATION_TARGET_MISSING");
          }
        } catch (error) {
          await db.collection<Character>("characters").updateOne(
            { _id: authUser.character._id },
            {
              $inc: { [campaignFundsField]: amount },
              $set: { updatedAt: new Date() },
            }
          );
          throw error;
        }
      }
    );

    await emitTreasuryTransaction({
      db,
      countryId,
      partyId,
      holderType: "state_party",
      holderId: statePartyKey,
      category: "donations",
      direction: "credit",
      amount,
      memo: `Donation from ${character.name}`,
      counterparty: {
        type: "character",
        id: authUser.character._id.toString(),
        label: character.name,
      },
      now,
    });

    // Fire-and-forget: log fund flow for admin activity tracking
    void db.collection("activityLog").insertOne({
      type: "fund_event",
      timestamp: new Date(),
      userId: new ObjectId(authUser.userId),
      characterId: authUser.character._id,
      characterName: authUser.character.name,
      username: authUser.username,
      countryId,
      fundEventType: "party_donation",
      amount,
      currencyCode: COUNTRY_CURRENCY_MAP[countryId] ?? "USD",
      fromId: authUser.character._id,
      fromName: authUser.character.name,
      fromType: "character",
      toId: party._id,
      toName: `${state.name} ${party.name}`,
      toType: "party",
    });

    return NextResponse.json({
      success: true,
      message: `Donated to ${state.name} ${party.name}`,
      amount,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "STATE_PARTY_DONATION_FUNDS_CHANGED") {
      return NextResponse.json(
        { error: "Your available campaign funds changed before the donation completed." },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.message === "STATE_PARTY_DONATION_TARGET_MISSING") {
      return NextResponse.json(
        { error: "The state party could not be credited because it changed during the donation." },
        { status: 409 }
      );
    }
    return handleRouteError(error);
  }
}
