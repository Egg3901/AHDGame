// GET  /api/country/[code]/executive/peace?conflictId=… — offers touching this country
// POST /api/country/[code]/executive/peace — offer to leave a war
// Auth: head of government OR the foreign seat holder — either one, no precedence.
// Errors: 400, 401, 403, 404, 409.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { requirePeaceNegotiator } from "@/lib/api/requirePeaceNegotiator";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { z } from "zod";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getGameStateCollection } from "@/lib/db/collections/gameState";
import { getConflict, listConflictsForCountry } from "@/lib/db/collections/conflicts";
import {
  getPeaceOffersCollection,
  findLiveOffer,
  listOffersForCountry,
  reapExpiredOffers,
} from "@/lib/db/collections/peaceOffers";
import { validatePeaceOffer, isOfferLive, maxIndemnityForGdp } from "@/lib/military/peaceOffer";
import type { FederalBudget } from "@/lib/db/types";
import { opposedBelligerents } from "@/lib/military/occupation";
import { PEACE_OFFER_DURATION_TURNS, type PeaceOfferDoc } from "@/lib/db/types/peaceOffer";
import { moderatedBillText } from "@/lib/api/schemas/congress";

const bodySchema = z.object({
  conflictId: z.string().min(1),
  toCountry: z.string().min(2).max(3),
  indemnity: z.object({
    payer: z.string().min(2).max(3),
    amount: z.number().finite().min(0),
  }),
  // Player-authored text another player reads, so it takes the body-copy policy —
  // not the stricter name filter reserved for public page titles.
  justification: moderatedBillText(z.string().max(1000)).optional(),
});

/** Shared preamble: country valid, conflicts on, authenticated, negotiator. */
async function open(code: string) {
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) {
    return { bad: NextResponse.json({ error: "Invalid country code" }, { status: 400 }) };
  }
  const auth = await requireAuthWithCharacter();
  if (!auth.ok) return { bad: auth.response };

  const db = await getDb();
  const gs = await (
    await getGameStateCollection(db)
  ).findOne({ _id: "current" }, { projection: { conflictsEnabled: 1, currentTurn: 1 } });
  if (!gs?.conflictsEnabled) {
    return { bad: NextResponse.json({ error: "Conflicts subsystem disabled" }, { status: 404 }) };
  }

  const { character } = auth.user;
  // Head of government OR the foreign seat holder, either one, no precedence —
  // the same shape declare-war uses for isHog || isDefence. NOT
  // requireForeignMinister, which gives a seated minister exclusivity and would
  // refuse the head of government outright.
  const gate = await requirePeaceNegotiator(db, countryId, character._id, auth.user.isAdmin);
  if (!gate.ok) return { bad: gate.response };

  return { db, countryId, character, currentTurn: gs.currentTurn ?? 0 };
}

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const ctx = await open(code);
    if (ctx.bad) return ctx.bad;
    const { db, countryId, currentTurn } = ctx;

    // Wars this country is actually FIGHTING, not merely hosting.
    // `listConflictsForCountry` also matches `hostCountry`, and a country can host a
    // war it is not a belligerent in — there is nothing for it to negotiate there.
    const wars = (await listConflictsForCountry(db, countryId)).filter(
      (c) =>
        (c.sideA.countries as string[]).includes(countryId) ||
        (c.sideB.countries as string[]).includes(countryId)
    );

    const offers = await listOffersForCountry(
      db,
      wars.map((w) => w._id),
      countryId
    );
    // Converge stale rows while we are here. Never the authority on liveness —
    // `isOfferLive` is — just bookkeeping that saves a scheduled sweeper.
    await reapExpiredOffers(db, offers, currentTurn);

    return NextResponse.json({
      currentTurn,
      wars: wars.map((w) => {
        const onA = (w.sideA.countries as string[]).includes(countryId);
        return {
          conflictId: w._id,
          conflictNumber: w.conflictId,
          name: w.name,
          // Only countries that can actually be offered terms: the opposing roster,
          // which is empty for a generated force and correctly offers nobody.
          enemies: (onA ? w.sideB.countries : w.sideA.countries).filter((e) =>
            opposedBelligerents(w, countryId, e)
          ),
        };
      }),
      offers: offers.map((o) => ({
        id: o._id.toString(),
        conflictId: o.conflictId,
        fromCountry: o.fromCountry,
        toCountry: o.toCountry,
        indemnity: o.indemnity,
        justification: o.justification ?? null,
        // Derived, not the stored field: a row can say "pending" and be expired.
        status: isOfferLive(o, currentTurn)
          ? "pending"
          : o.status === "pending"
            ? "expired"
            : o.status,
        offeredTurn: o.offeredTurn,
        expiresTurn: o.expiresTurn,
        /** True when this country is the one being asked to accept. */
        incoming: o.toCountry === countryId,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const ctx = await open(code);
    if (ctx.bad) return ctx.bad;
    const { db, countryId, character, currentTurn } = ctx;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const toCountry = parsed.data.toCountry.toUpperCase() as CountryId;
    const payer = parsed.data.indemnity.payer.toUpperCase() as CountryId;
    const indemnity = { payer, amount: parsed.data.indemnity.amount };

    const conflict = await getConflict(db, parsed.data.conflictId);
    if (!conflict) {
      return NextResponse.json({ error: "That war does not exist." }, { status: 404 });
    }

    // Cap the indemnity at a multiple of the PAYER's GDP. Without it, `amount` is
    // bounded only by `>= 0`, and accept would move an arbitrary sum. Reject a
    // payer with no usable GDP rather than assume one (an assumed GDP is an
    // uncapped indemnity by the back door).
    const payerBudget = await db
      .collection<FederalBudget>("federalBudget")
      .findOne({ countryId: payer }, { projection: { gdp: 1 } });
    const maxAmount = maxIndemnityForGdp(payerBudget?.gdp);
    if (maxAmount == null) {
      return NextResponse.json(
        { error: "The paying country has no GDP on record to size an indemnity against." },
        { status: 400 }
      );
    }

    const check = validatePeaceOffer(conflict, countryId, toCountry, indemnity, maxAmount);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

    // One live offer per (conflict, from, to). Re-offering means withdrawing first,
    // so a country cannot paper the recipient with variants. Directional on purpose:
    // the other side may hold its own open offer at the same time.
    const existing = await findLiveOffer(db, conflict._id, countryId, toCountry, currentTurn);
    if (existing) {
      return NextResponse.json(
        { error: "You already have an offer open with that country. Withdraw it first." },
        { status: 409 }
      );
    }

    const doc = {
      conflictId: conflict._id,
      fromCountry: countryId,
      toCountry,
      indemnity,
      ...(parsed.data.justification ? { justification: parsed.data.justification } : {}),
      status: "pending" as const,
      offeredTurn: currentTurn,
      expiresTurn: currentTurn + PEACE_OFFER_DURATION_TURNS,
      offeredBy: character._id.toString(),
    };
    const result = await getPeaceOffersCollection(db).insertOne(doc as unknown as PeaceOfferDoc);

    return NextResponse.json({
      success: true,
      offerId: result.insertedId.toString(),
      expiresTurn: doc.expiresTurn,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
