import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { partyDonateSchema } from "@/lib/api/schemas/settings";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import type { PoliticalParty, Character } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { isBannedParty } from "@/lib/turn/onePartyConstraints";
import { getCountryState } from "@/lib/countryState";
import { emitTreasuryTransaction } from "@/lib/treasury/emit";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { requirePlayerTransfersEnabled } from "@/lib/api/requirePlayerTransfers";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { localCampaignBalance } from "@/lib/currency/campaignBalance";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

// POST /api/country/[code]/parties/[id]/donate — Donate personal funds to the national party treasury
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(authResult.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const authUser = authResult.user;

    const parsed = await parseJsonBody(request, partyDonateSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { amount } = parsed.data;

    const db = await getDb();
    const transferGuard = await requirePlayerTransfersEnabled(db);
    if (transferGuard) return transferGuard;

    // Verify party exists
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    // One-party-state guard: banned parties cannot accept donations.
    // Reads runtime governmentType so a post-Stage-4 conversion immediately
    // lifts the restriction.
    const runtime = await getCountryState(db, countryId);
    if (isBannedParty({ governmentType: runtime.governmentType }, party)) {
      return NextResponse.json(
        { error: "Banned parties cannot accept donations." },
        { status: 403 }
      );
    }

    // Check authorization: must be a member of this party
    const [character, forexEnabled] = await Promise.all([
      db.collection<Character>("characters").findOne({ _id: authUser.character._id }),
      isForexEnabled(),
    ]);

    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    // Must match both party AND country to avoid cross-country collisions
    const partyCountryId = party.countryId ?? "US";
    if (character.party !== partyId || (character.countryId ?? "US") !== partyCountryId) {
      return NextResponse.json(
        { error: "You must be a member of this party to donate" },
        { status: 403 }
      );
    }

    // Post-Phase-6: `amount`, character campaign balance, and party treasury
    // are ALL in the same local home currency (same country = same currency).
    // No FX conversion needed anywhere along this flow.
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
          throw new Error("PARTY_DONATION_FUNDS_CHANGED");
        }

        const creditResult = await db
          .collection<PoliticalParty>("politicalParties")
          .updateOne(
            { _id: party._id },
            { $inc: { treasury: amount }, $set: { updatedAt: now } },
            { session }
          );

        if (creditResult.modifiedCount === 0) {
          throw new Error("PARTY_DONATION_PARTY_MISSING");
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
          throw new Error("PARTY_DONATION_FUNDS_CHANGED");
        }

        try {
          const creditResult = await db
            .collection<PoliticalParty>("politicalParties")
            .updateOne(
              { _id: party._id },
              { $inc: { treasury: amount }, $set: { updatedAt: now } }
            );

          if (creditResult.modifiedCount === 0) {
            throw new Error("PARTY_DONATION_PARTY_MISSING");
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
      holderType: "party",
      holderId: partyId,
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

    return NextResponse.json({
      success: true,
      message: `Donated $${amount.toLocaleString()} to ${party.name}`,
      amount,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PARTY_DONATION_FUNDS_CHANGED") {
      return NextResponse.json(
        { error: "Your available campaign funds changed before the donation completed." },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.message === "PARTY_DONATION_PARTY_MISSING") {
      return NextResponse.json(
        { error: "The party could not be credited because it changed during the donation." },
        { status: 409 }
      );
    }
    return handleRouteError(error);
  }
}
