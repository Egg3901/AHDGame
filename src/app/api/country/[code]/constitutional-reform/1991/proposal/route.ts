import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { checkLegislationFreeze } from "@/lib/api/parliamentaryFreeze";
import {
  loadBg1991ConstitutionalDecision,
  openBg1991ConstitutionalProposal,
  Bg1991ConstitutionalConflict,
  endorseBg1991ConstitutionalInitiative,
} from "@/lib/countries/bg/constitutionalProposals1991";
import { Bg1991InitiativeConflict } from "@/lib/countries/bg/constitutionalInitiative1991";

const bodySchema = z
  .object({
    kind: z.literal("constitution1991"),
    action: z.enum(["introduce", "endorse"]).optional(),
  })
  .strict();
type Context = { params: Promise<{ code: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    if ((await params).code.toUpperCase() !== "BG")
      return NextResponse.json(
        { error: "No Bulgarian constitutional decision here" },
        { status: 404 }
      );
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const db = await getDb();
    const game = await getGameState(db);
    return NextResponse.json(
      {
        decision: game
          ? await loadBg1991ConstitutionalDecision(db, game, game.currentTurn ?? 1)
          : null,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    if ((await params).code.toUpperCase() !== "BG")
      return NextResponse.json(
        { error: "No Bulgarian constitutional decision here" },
        { status: 404 }
      );
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const limit = checkRateLimit(`bg-constitutional-reform:${auth.user.userId}`, 5, 60_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);
    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const db = await getDb();
    const game = await getGameState(db);
    if (game?.preset !== "1991-default")
      return NextResponse.json({ error: "No electoral decision in this era" }, { status: 409 });
    const character = await getCharacterByUserId(db, auth.user.userId);
    const official = character
      ? await db.collection("electedOfficials").findOne(
          {
            characterId: character._id,
            countryId: "BG",
            officeType: {
              $in:
                parsed.data.action === "endorse"
                  ? ["assemblyDeputy"]
                  : ["primeMinister", "president"],
            },
            seatsHeld: { $ne: 0 },
          },
          { projection: { party: 1 } }
        )
      : null;
    if (!official && (parsed.data.action === "endorse" || auth.user.isAdmin !== true))
      return NextResponse.json(
        {
          error:
            parsed.data.action === "endorse"
              ? "A seated constituent deputy must endorse this initiative"
              : "The Bulgarian government or President must introduce this draft",
        },
        { status: 403 }
      );
    const freeze = await checkLegislationFreeze("BG");
    if (!freeze.ok) return freeze.response;
    const input = {
      db,
      game,
      turn: game.currentTurn ?? 1,
      now: new Date(),
      sponsor: official && character ? character : null,
      sponsorParty: typeof official?.party === "string" ? official.party : undefined,
    };
    if (parsed.data.action === "endorse") {
      const result = await endorseBg1991ConstitutionalInitiative(input);
      return NextResponse.json(
        {
          initiative: result.initiative,
          ...(result.proposal
            ? {
                billId: result.proposal.billId.toHexString(),
                revision: result.proposal.revision,
                status: result.proposal.status,
              }
            : {}),
        },
        { status: result.proposal ? 201 : 202, headers: { "Cache-Control": "private, no-store" } }
      );
    }
    const proposal = await openBg1991ConstitutionalProposal(input);
    return NextResponse.json(
      {
        billId: proposal.billId.toHexString(),
        revision: proposal.revision,
        status: proposal.status,
      },
      { status: 201, headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    if (error instanceof Bg1991ConstitutionalConflict || error instanceof Bg1991InitiativeConflict)
      return NextResponse.json({ error: error.message }, { status: 409 });
    return handleRouteError(error);
  }
}
