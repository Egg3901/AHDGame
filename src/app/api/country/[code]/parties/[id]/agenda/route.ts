import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getGameState } from "@/lib/gameState";
import { setNationalAgenda } from "@/lib/parties/commands/setNationalAgenda";
import { getCurrentAgenda } from "@/lib/parties/queries/currentAgenda";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

const agendaSchema = z.object({
  headline: z.string().min(1).max(120),
  detail: z.string().max(500).optional().default(""),
});

// GET /api/country/[code]/parties/[id]/agenda — return the active agenda for this party.
// Auth: any authenticated user can read (the banner is shown to everyone).
export async function GET(_request: Request, { params }: RouteParams) {
  const { code, id: partyId } = await params;
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) {
    return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
  }

  const db = await getDb();
  const party = await findPartyBySequentialId(db, partyId, countryId);
  if (!party) return NextResponse.json({ error: "Party not found" }, { status: 404 });

  const gameState = await getGameState(db);
  const currentTurn = gameState?.currentTurn ?? 0;
  const iterationId = gameState?.iteration
    ? `${gameState.iteration.type}-${gameState.iteration.number}`
    : "default";

  const agenda = await getCurrentAgenda(
    db,
    countryId,
    String(party.sequentialId),
    iterationId,
    currentTurn
  );
  return NextResponse.json({ agenda });
}

// POST /api/country/[code]/parties/[id]/agenda — chair-only set the National Agenda.
// Auth: requireAuthWithCharacter; chair / vice-chair / admin only.
// Errors: 400, 401, 403, 404
export async function POST(request: Request, { params }: RouteParams) {
  const { code, id: partyId } = await params;
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) {
    return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
  }

  const authResult = await requireAuthWithCharacter();
  if (!authResult.ok) return authResult.response;
  const authUser = authResult.user;

  const parsed = await parseJsonBody(request, agendaSchema);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }

  const db = await getDb();
  const party = await findPartyBySequentialId(db, partyId, countryId);
  if (!party) return NextResponse.json({ error: "Party not found" }, { status: 404 });

  const isAdmin = authUser.isAdmin;
  const isChair = party.chairId?.equals(authUser.character._id);
  const isViceChair = party.viceChairId?.equals(authUser.character._id);
  if (!isAdmin && !isChair && !isViceChair) {
    return NextResponse.json(
      { error: "Only the party chair, vice chair, or an admin can set the agenda" },
      { status: 403 }
    );
  }

  const gameState = await getGameState(db);
  const currentTurn = gameState?.currentTurn ?? 0;
  const iterationId = gameState?.iteration
    ? `${gameState.iteration.type}-${gameState.iteration.number}`
    : "default";

  const result = await setNationalAgenda(
    {
      countryId,
      partyId: String(party.sequentialId),
      iterationId,
      headline: parsed.data.headline,
      detail: parsed.data.detail ?? "",
      setBy: authUser.character._id,
      setAtTurn: currentTurn,
    },
    db
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  return NextResponse.json({ ok: true, agendaId: result.agendaId.toString() });
}
