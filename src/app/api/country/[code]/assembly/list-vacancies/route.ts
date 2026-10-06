import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse, statusResponse } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import {
  designateHu1991ListDeputy,
  Hu1991ListVacancyConflict,
  loadHu1991ListVacancies,
  loadHu1991ListReplacementHistory,
} from "@/lib/countries/hu/listVacancies1991";

type Context = { params: Promise<{ code: string }> };
const schema = z
  .object({
    receiptId: z.string().min(1).max(160),
    slotPersonId: z.string().min(1).max(160),
    personId: z.string().min(1).max(160),
  })
  .strict();

export async function GET(_request: Request, { params }: Context) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    if ((await params).code.toUpperCase() !== "HU")
      return errorResponse(404, "No Hungarian list mandate here");
    const db = await getDb();
    const game = await getGameState(db);
    return NextResponse.json(
      {
        history: game?.preset === "1991-default" ? await loadHu1991ListReplacementHistory(db) : [],
        vacancies:
          game?.preset === "1991-default"
            ? await loadHu1991ListVacancies(db, game.currentTurn)
            : [],
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    if ((await params).code.toUpperCase() !== "HU")
      return errorResponse(404, "No Hungarian list mandate here");
    const limit = checkRateLimit(`hu-list-vacancy:${auth.user.userId}`, 5, 60_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const db = await getDb();
    const game = await getGameState(db);
    if (game?.preset !== "1991-default")
      return errorResponse(409, "No original Hungarian party list in this world");
    const character = await getCharacterByUserId(db, auth.user.userId);
    if (auth.user.isAdmin !== true && character?.countryId !== "HU")
      return errorResponse(403, "A Hungarian party chair must designate its deputy");
    const installed = await designateHu1991ListDeputy({
      db,
      turn: game.currentTurn,
      now: new Date(),
      ...parsed.data,
      actor: { characterId: character?._id ?? null, isAdmin: auth.user.isAdmin === true },
    });
    return statusResponse(
      installed ? 200 : 409,
      installed ? { success: true } : { error: "This list vacancy is no longer available" },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    if (error instanceof Hu1991ListVacancyConflict) return errorResponse(409, error.message);
    return handleRouteError(error);
  }
}
