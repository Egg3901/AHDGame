import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { loadRuntimeCountryOffices } from "@/lib/countries/runtimeOffices";
import { checkLegislationFreeze } from "@/lib/api/parliamentaryFreeze";
import {
  loadRussianConstitutionalDecisions,
  openRussianConstitutionalProposal,
  RussianConstitutionalDecisionConflict,
} from "@/lib/countries/ru/constitutionalProposals";
import {
  loadRussianCouncilFormationDecisions,
  openRussianCouncilFormationProposal,
} from "@/lib/countries/ru/councilFormationProposals";
import {
  loadRussianDuma1995Decisions,
  openRussianDuma1995Proposal,
} from "@/lib/countries/ru/dumaElectoralProposals1995";
const bodySchema = z
  .object({
    kind: z.enum([
      "presidency",
      "federalAssembly",
      "regionalHeads",
      "regionalDelegates",
      "law1995",
    ]),
  })
  .strict();
type RouteContext = { params: Promise<{ code: string }> };
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    if ((await params).code.toUpperCase() !== "RU")
      return NextResponse.json(
        { error: "No Russian constitutional decision here" },
        { status: 404 }
      );
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const db = await getDb();
    const game = await getGameState(db);
    if (!game) return NextResponse.json({ decisions: [] });
    return NextResponse.json(
      {
        decisions: [
          ...(await loadRussianConstitutionalDecisions(db, game, game.currentTurn ?? 1)),
          ...(await loadRussianCouncilFormationDecisions(db, game, game.currentTurn ?? 1)),
          ...(await loadRussianDuma1995Decisions(db, game, game.currentTurn ?? 1)),
        ],
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
export async function POST(request: Request, { params }: RouteContext) {
  try {
    if ((await params).code.toUpperCase() !== "RU")
      return NextResponse.json(
        { error: "No Russian constitutional decision here" },
        { status: 404 }
      );
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const limit = checkRateLimit(`ru-constitution:${auth.user.userId}`, 5, 60_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);
    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const db = await getDb();
    const game = await getGameState(db);
    if (game?.preset !== "1991-default")
      return NextResponse.json(
        { error: "No constitutional decision in this era" },
        { status: 409 }
      );
    const offices = await loadRuntimeCountryOffices(db, "RU", game.preset);
    const character = await getCharacterByUserId(db, auth.user.userId);
    const official = character
      ? await db.collection("electedOfficials").findOne(
          {
            characterId: character._id,
            countryId: "RU",
            officeType: { $in: offices.jointSittingOfficeTypes },
          },
          { projection: { _id: 1, party: 1 } }
        )
      : null;
    if (!official && auth.user.isAdmin !== true)
      return NextResponse.json(
        { error: "A seated Russian legislator must open this decision" },
        { status: 403 }
      );
    const freeze = await checkLegislationFreeze("RU");
    if (!freeze.ok) return freeze.response;
    const input = {
      db,
      game,
      turn: game.currentTurn ?? 1,
      now: new Date(),
      sponsor: official && character ? character : null,
      sponsorParty: typeof official?.party === "string" ? official.party : undefined,
    };
    const proposal =
      parsed.data.kind === "regionalHeads" || parsed.data.kind === "regionalDelegates"
        ? await openRussianCouncilFormationProposal({ ...input, mode: parsed.data.kind })
        : parsed.data.kind === "law1995"
          ? await openRussianDuma1995Proposal(input)
          : await openRussianConstitutionalProposal({ ...input, kind: parsed.data.kind });
    return NextResponse.json(
      {
        billId: proposal.billId.toHexString(),
        revision: proposal.revision,
        status: proposal.status,
      },
      { status: 201, headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    if (error instanceof RussianConstitutionalDecisionConflict)
      return NextResponse.json({ error: error.message }, { status: 409 });
    return handleRouteError(error);
  }
}
