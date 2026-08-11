// POST /api/country/[code]/executive/peace/[offerId] — accept, reject or withdraw
// Auth: head of government OR the foreign seat holder — either one, no precedence.
// Errors: 400, 401, 403, 404, 409.
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { requirePeaceNegotiator } from "@/lib/api/requirePeaceNegotiator";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { z } from "zod";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getGameStateCollection } from "@/lib/db/collections/gameState";
import { getConflict } from "@/lib/db/collections/conflicts";
import { getPeaceOffersCollection } from "@/lib/db/collections/peaceOffers";
import { isOfferLive, validatePeaceOffer, maxIndemnityForGdp } from "@/lib/military/peaceOffer";
import { acceptPeace } from "@/lib/military/acceptPeace";
import type { FederalBudget } from "@/lib/db/types";

const bodySchema = z.object({ action: z.enum(["accept", "reject", "withdraw"]) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; offerId: string }> }
) {
  try {
    const { code, offerId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    if (!ObjectId.isValid(offerId)) {
      return NextResponse.json({ error: "That offer does not exist." }, { status: 404 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const { character } = auth.user;

    const db = await getDb();
    const gs = await (
      await getGameStateCollection(db)
    ).findOne({ _id: "current" }, { projection: { conflictsEnabled: 1, currentTurn: 1 } });
    if (!gs?.conflictsEnabled) {
      return NextResponse.json({ error: "Conflicts subsystem disabled" }, { status: 404 });
    }
    const currentTurn = gs.currentTurn ?? 0;

    const gate = await requirePeaceNegotiator(db, countryId, character._id, auth.user.isAdmin);
    if (!gate.ok) return gate.response;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { action } = parsed.data;

    const offer = await getPeaceOffersCollection(db).findOne({ _id: new ObjectId(offerId) });
    if (!offer) {
      return NextResponse.json({ error: "That offer does not exist." }, { status: 404 });
    }

    // Lazy expiry: a row can still say "pending" and be long dead. Checked here so a
    // stale offer cannot be accepted, rejected or withdrawn into a different state.
    if (!isOfferLive(offer, currentTurn)) {
      await getPeaceOffersCollection(db).updateOne(
        { _id: offer._id, status: "pending" },
        { $set: { status: "expired" } }
      );
      return NextResponse.json({ error: "That offer is no longer open." }, { status: 409 });
    }

    // Withdrawing is the offerer's move; accepting and rejecting are the recipient's.
    // Getting this backwards would let a country accept its own offer.
    const mustBe = action === "withdraw" ? offer.fromCountry : offer.toCountry;
    if (mustBe !== countryId) {
      return NextResponse.json(
        {
          error:
            action === "withdraw"
              ? "Only the country that made an offer can withdraw it."
              : "Only the country an offer was made to can answer it.",
        },
        { status: 403 }
      );
    }

    if (action !== "accept") {
      const status = action === "reject" ? "rejected" : "withdrawn";
      const r = await getPeaceOffersCollection(db).updateOne(
        { _id: offer._id, status: "pending" },
        {
          $set: {
            status,
            resolvedBy: character._id.toString(),
            resolvedTurn: currentTurn,
          },
        }
      );
      if (r.modifiedCount === 0) {
        return NextResponse.json({ error: "That offer is no longer open." }, { status: 409 });
      }
      return NextResponse.json({ success: true, status });
    }

    // Revalidated at acceptance, not just at offer time. An offer sits for turns
    // while the world moves: the war may have ended, or either party may have left
    // it, and applying a stale deal would move money over a war nobody is fighting.
    const conflict = await getConflict(db, offer.conflictId);
    if (!conflict) {
      return NextResponse.json({ error: "That war no longer exists." }, { status: 409 });
    }
    // Re-check the GDP cap at acceptance too: an offer stored before the cap
    // existed, or one whose payer's GDP has since fallen, must not move an
    // over-cap sum. maxIndemnityForGdp(null) → null skips the cap only when the
    // payer has no GDP, which validatePeaceOffer treats as "no ceiling passed";
    // that mirrors the pre-cap behaviour for the (unexpected) no-GDP payer and
    // never loosens a real cap.
    const payerBudget = await db
      .collection<FederalBudget>("federalBudget")
      .findOne({ countryId: offer.indemnity.payer }, { projection: { gdp: 1 } });
    const still = validatePeaceOffer(
      conflict,
      offer.fromCountry,
      offer.toCountry,
      offer.indemnity,
      maxIndemnityForGdp(payerBudget?.gdp)
    );
    if (!still.ok) {
      return NextResponse.json({ error: still.error }, { status: 409 });
    }

    const applied = await acceptPeace(db, offer, conflict, currentTurn, character._id.toString());
    if (!applied.applied) {
      return NextResponse.json({ error: "That offer is no longer open." }, { status: 409 });
    }

    return NextResponse.json({
      success: true,
      status: "accepted",
      warResolved: applied.resolved,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
