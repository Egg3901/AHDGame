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
import {
  validatePeaceOffer,
  isOfferLive,
  maxIndemnityForGdp,
  withdrawalGate,
  loadPartySequentialIds,
  loadPartyChoicesFor,
} from "@/lib/military/peaceOffer";
import type { PeaceTerm } from "@/lib/military/peaceTerm";
import { isConflictConcluded } from "@/lib/military/conflictLifecycle";
import { getCountryState } from "@/lib/countryState";
import type { FederalBudget } from "@/lib/db/types";
import { opposedBelligerents } from "@/lib/military/occupation";
import { PEACE_OFFER_DURATION_TURNS, type PeaceOfferDoc } from "@/lib/db/types/peaceOffer";
import { moderatedBillText } from "@/lib/api/schemas/congress";

const bodySchema = z.object({
  conflictId: z.string().min(1),
  toCountry: z.string().min(2).max(3),
  // A discriminated union, so a body carrying two terms cannot parse. Note
  // `parliamentaryMonarchy` is deliberately ABSENT: a settlement cannot install a
  // crown, and refusing it at the schema is stronger than refusing it in the
  // validator alone.
  /**
   * Which party this deal removes. Omitted means the sender, which is the original
   * shape and what every existing client sends.
   */
  leaver: z.enum(["us", "them"]).optional(),
  term: z.discriminatedUnion("kind", [
    // A white peace carries no fields: it is the absence of a term, and the whole of
    // its effect is that the war resolves with no victor recorded.
    z.object({ kind: z.literal("white_peace") }),
    z.object({
      kind: z.literal("indemnity"),
      payer: z.string().min(2).max(3),
      amount: z.number().finite().min(0),
    }),
    z.object({
      kind: z.literal("regime_change"),
      targetSystem: z.enum(["presidential", "parliamentaryRepublic", "onePartyState"]),
      // Which party takes power. Only meaningful for `onePartyState`, which
      // `validatePeaceTerm` enforces — the schema accepts it either way so the
      // contradiction is refused with a reason rather than a shape error.
      rulingPartyId: z.number().int().positive().optional(),
    }),
    z.object({
      kind: z.literal("demilitarisation"),
      turns: z.number().int().positive(),
    }),
  ]),
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
    // A war awaiting terms is excluded too: it has already been won, the POST would
    // refuse an offer for it, and listing it would put a choice in the dropdown that
    // cannot go anywhere.
    const wars = (await listConflictsForCountry(db, countryId)).filter(
      (c) =>
        !isConflictConcluded(c.status) &&
        ((c.sideA.countries as string[]).includes(countryId) ||
          (c.sideB.countries as string[]).includes(countryId))
    );

    const offers = await listOffersForCountry(
      db,
      wars.map((w) => w._id),
      countryId
    );
    // Converge stale rows while we are here. Never the authority on liveness —
    // `isOfferLive` is — just bookkeeping that saves a scheduled sweeper.
    await reapExpiredOffers(db, offers, currentTurn);

    // Party lists for every country that could be offered terms, so the form can
    // name a ruling party on a conversion to a one-party state. Loaded ONCE for
    // the whole payload rather than per war: a country on two fronts is one
    // lookup, not two, and the enemy map below stays synchronous.
    const enemyCountries = new Set<CountryId>();
    for (const w of wars) {
      const onA = (w.sideA.countries as string[]).includes(countryId);
      for (const e of onA ? w.sideB.countries : w.sideA.countries) {
        if (opposedBelligerents(w, countryId, e)) enemyCountries.add(e);
      }
    }
    // A regime change that NAMES a ruling party is a materially different deal
    // from one that leaves it to resolve, and the country being asked to accept
    // has to be able to see which party it would be handing power to. The term
    // stores an id; the reader needs a name. An offer's target is added to the
    // same load, because an incoming offer converts US and the enemy set covers
    // only the countries we could offer terms to.
    for (const offer of offers) {
      if (offer.term.kind !== "regime_change" || offer.term.rulingPartyId == null) continue;
      enemyCountries.add(offer.toCountry);
    }

    // ONE query for every country involved, not one per country: a nation on
    // several fronts would otherwise turn a single page load into ten round trips.
    const partiesByCountry = await loadPartyChoicesFor(db, [...enemyCountries]);
    const nameOf = (country: CountryId, partyId: number): string | null =>
      partiesByCountry.get(country)?.find((p) => p.id === partyId)?.abbreviation ??
      partiesByCountry.get(country)?.find((p) => p.id === partyId)?.name ??
      null;

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
          //
          // Each carries the withdrawal gate's verdict, so the form can say why a
          // country cannot simply be asked to leave BEFORE a player composes an offer
          // the route would refuse. Computed by the same `withdrawalGate` the POST
          // runs, so the two cannot drift; the server stays the authority.
          // What OUR own departure would do, for the same reason: the panel must say
          // whether leaving ends the war rather than claiming the fighting always
          // carries on without us.
          ourDeparture: (() => {
            const g = withdrawalGate(w, countryId, countryId);
            return { endsWar: g.endsWar, guestsLeaving: g.guests };
          })(),
          enemies: (onA ? w.sideB.countries : w.sideA.countries)
            .filter((e) => opposedBelligerents(w, countryId, e))
            .map((e) => {
              const gate = withdrawalGate(w, countryId, e);
              return {
                country: e,
                endsWar: gate.endsWar,
                guestsLeaving: gate.guests,
                withdrawalBlocked: gate.blocked,
                // Whole percents, for copy. The form shows the reader how far off
                // they are rather than only that they are.
                progressPct: Math.round(gate.progress * 100),
                requiredPct: Math.round(gate.required * 100),
                // The parties a conversion could install here. Same helper the
                // POST validates against, so anything offerable is acceptable.
                parties: partiesByCountry.get(e) ?? [],
              };
            }),
        };
      }),
      offers: offers.map((o) => ({
        id: o._id.toString(),
        conflictId: o.conflictId,
        fromCountry: o.fromCountry,
        toCountry: o.toCountry,
        term: o.term,
        /**
         * The named ruling party's display name, when the term names one. Null
         * otherwise, which is also what a term that leaves the choice to the
         * conversion reads as.
         */
        rulingPartyName:
          o.term.kind === "regime_change" && o.term.rulingPartyId != null
            ? nameOf(o.toCountry, o.term.rulingPartyId)
            : null,
        leaver: o.leaver,
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
    // Country codes arrive in whatever case the client sent. Normalised here so the
    // validator's payer comparison against `from`/`to` is not case-sensitive.
    const term: PeaceTerm =
      parsed.data.term.kind === "indemnity"
        ? {
            kind: "indemnity",
            payer: parsed.data.term.payer.toUpperCase() as CountryId,
            amount: parsed.data.term.amount,
          }
        : parsed.data.term;

    const conflict = await getConflict(db, parsed.data.conflictId);
    if (!conflict) {
      return NextResponse.json({ error: "That war does not exist." }, { status: 404 });
    }

    // Cap the indemnity at a multiple of the PAYER's GDP. Without it, `amount` is
    // bounded only by `>= 0`, and accept would move an arbitrary sum. Reject a
    // payer with no usable GDP rather than assume one (an assumed GDP is an
    // uncapped indemnity by the back door).
    //
    // Only read for an indemnity: a GDP ceiling is meaningless for the other terms,
    // and refusing a regime change because the target has no GDP on record would be
    // a bar with no reason behind it.
    let maxAmount: number | null = null;
    if (term.kind === "indemnity") {
      const payerBudget = await db
        .collection<FederalBudget>("federalBudget")
        .findOne({ countryId: term.payer }, { projection: { gdp: 1 } });
      maxAmount = maxIndemnityForGdp(payerBudget?.gdp);
      if (maxAmount == null) {
        return NextResponse.json(
          { error: "The paying country has no GDP on record to size an indemnity against." },
          { status: 400 }
        );
      }
    }

    // The target's live system, so a conversion that would change nothing is
    // refused before it is ever offered.
    const targetState = await getCountryState(db, toCountry);

    // "them" asks the recipient to withdraw while we stay in the war; the default
    // keeps the original shape, where the sender is the one leaving.
    const leaver = parsed.data.leaver === "them" ? toCountry : countryId;

    // Loaded only for the term that can name a party, so an indemnity or a
    // demilitarisation does not pay for a query it never reads.
    const targetPartyIds =
      term.kind === "regime_change" && term.rulingPartyId != null
        ? await loadPartySequentialIds(db, toCountry)
        : null;

    const check = validatePeaceOffer(
      conflict,
      countryId,
      toCountry,
      term,
      leaver,
      maxAmount,
      targetState.governmentType,
      targetPartyIds
    );
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
      leaver,
      term,
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
