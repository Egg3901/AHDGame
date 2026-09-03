// POST /api/country/[code]/executive/conflicts/[conflictId]/terms — impose the
// terms of a war won outright.
// Auth: head of government OR the foreign seat holder, either one, no precedence.
// Errors: 400, 401, 403, 404, 409.
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { requirePeaceNegotiator } from "@/lib/api/requirePeaceNegotiator";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getGameStateCollection } from "@/lib/db/collections/gameState";
import { getConflict, getConflictsCollection } from "@/lib/db/collections/conflicts";
import type { FederalBudget } from "@/lib/db/types";
import { getCountryState } from "@/lib/countryState";
import { maxIndemnityForGdp, loadPartySequentialIds } from "@/lib/military/peaceOffer";
import { loadTermSettlement } from "@/lib/settlement/queries/termSettlement";
import { validatePeaceTerm, type PeaceTerm } from "@/lib/military/peaceTerm";
import { applyPeaceTerm } from "@/lib/military/applyPeaceTerm";
import { resolveConflict } from "@/lib/military/resolveConflict";

const bodySchema = z.object({
  // The same discriminated union the offer route takes, and `parliamentaryMonarchy`
  // is absent from it for the same reason: a settlement cannot install a crown, and
  // refusing it at the schema is stronger than refusing it in the validator alone.
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
    // Carries no fields: the crisis names the two Germanies.
    z.object({ kind: z.literal("reunification") }),
  ]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; conflictId: string }> }
) {
  try {
    const { code, conflictId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
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

    // The same seat gate the peace routes use: head of government or the foreign
    // seat holder, either one, no precedence.
    const gate = await requirePeaceNegotiator(db, countryId, character._id, auth.user.isAdmin);
    if (!gate.ok) return gate.response;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const conflict = await getConflict(db, conflictId);
    if (!conflict) {
      return NextResponse.json({ error: "That war does not exist." }, { status: 404 });
    }
    if (conflict.status !== "terms_pending" || !conflict.termsWindow) {
      return NextResponse.json({ error: "That war is not awaiting terms." }, { status: 409 });
    }
    // Refused here as well as by the sweeper. The sweep runs on a tick, so a window
    // can be past its closing turn for a while before anything acts on it, and a
    // victor must not be able to impose inside that gap.
    if (currentTurn >= conflict.termsWindow.closesTurn) {
      return NextResponse.json(
        { error: "The window to impose terms on that war has closed." },
        { status: 409 }
      );
    }
    // THE COUNTRY GATE, and the whole reason a coalition victory yields one term
    // rather than one per ally.
    if (conflict.termsWindow.imposer !== countryId) {
      return NextResponse.json(
        { error: "Only the country that led this war to victory can impose its terms." },
        { status: 403 }
      );
    }

    const target = conflict.termsWindow.target;
    const term = normaliseTerm(parsed.data.term);

    // The GDP ceiling is only meaningful for an indemnity. Reading it for the other
    // terms would refuse a settlement over a figure it does not contain.
    let maxIndemnity: number | null = null;
    if (term.kind === "indemnity") {
      const payerBudget = await db
        .collection<FederalBudget>("federalBudget")
        .findOne({ countryId: term.payer }, { projection: { gdp: 1 } });
      maxIndemnity = maxIndemnityForGdp(payerBudget?.gdp);
      if (maxIndemnity == null) {
        return NextResponse.json(
          { error: "The paying country has no GDP on record to size an indemnity against." },
          { status: 400 }
        );
      }
    }

    const targetState = await getCountryState(db, target);
    // Loaded only for the term that can name a party, so an indemnity or a
    // demilitarisation does not pay for a query it never reads.
    const targetPartyIds =
      term.kind === "regime_change" && term.rulingPartyId != null
        ? await loadPartySequentialIds(db, target)
        : null;
    // Loaded only for the term that settles a crisis. Null REFUSES a reunification
    // rather than skipping the check, unlike the two above it.
    const settlement =
      term.kind === "reunification" ? await loadTermSettlement(db, conflict._id) : null;

    const check = validatePeaceTerm(term, {
      from: countryId,
      to: target,
      target,
      targetSystem: targetState.governmentType,
      maxIndemnity,
      targetPartyIds,
      settlement,
    });
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

    // CLAIM THE WAR BEFORE APPLYING ANYTHING. Two simultaneous requests both pass
    // every check above; only one can move this document off `terms_pending`, and
    // the loser applies nothing. Without the status in the filter, both would
    // impose, and `applyPeaceTerm` is not replayable: it moves money and converts
    // governments. This is the same guard `acceptPeace` makes on the offer.
    const claim = await getConflictsCollection(db).updateOne(
      { _id: conflict._id, status: "terms_pending" },
      {
        $set: {
          status: "resolved" as const,
          settlement: {
            term,
            path: "dictated" as const,
            imposedBy: countryId,
            target,
            turn: currentTurn,
          },
        },
      }
    );
    if (claim.modifiedCount === 0) {
      return NextResponse.json({ error: "That war is already settled." }, { status: 409 });
    }

    await applyPeaceTerm(db, term, {
      imposer: countryId,
      target,
      conflictId: conflict._id,
      currentTurn,
    });

    // Stamps the outcome and records a 240-turn truce for every cross-side pair. Runs
    // AFTER the term so a regime change lands on the country while it is still a
    // belligerent on the record.
    //
    // A WHITE PEACE names no victor, even here where one plainly won the ground: the
    // point of choosing it is that the war is recorded as settling nothing. That is
    // what lets a question being fought over go back to being a question.
    await resolveConflict(
      db,
      conflict,
      term.kind === "white_peace" ? "stalemate" : conflict.termsWindow.victor,
      currentTurn
    );

    return NextResponse.json({ success: true, term });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * Upper-case the country code on an indemnity.
 *
 * Codes arrive in whatever case the client sent, and `validatePeaceTerm` compares
 * the payer against the two parties by identity. The other terms carry no country
 * code to normalise.
 */
function normaliseTerm(term: z.infer<typeof bodySchema>["term"]): PeaceTerm {
  return term.kind === "indemnity"
    ? { kind: "indemnity", payer: term.payer.toUpperCase() as CountryId, amount: term.amount }
    : term;
}
