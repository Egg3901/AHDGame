/**
 * POST /api/unions/[id]/organize-sectors: run targeted drives on several
 * sectors in one request, in the order given. Each drive is the same
 * `organizeSector` command the single-sector route runs, with the same costs
 * and contest. The batch stops at the first refusal, so a player who runs out
 * of action points or treasury mid-batch is told which drive stopped it and
 * keeps every drive that already landed.
 *
 * One request counts once against the rate limit, which is why this exists:
 * a client looping the single-sector route would burn the shared per-user
 * budget and lock the player out of every other action for a minute.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { isLabourFullMode } from "@/lib/labour/featureFlag";
import { organizeSector } from "@/lib/unions/commands/organizeSector";
import { ORGANIZE_SECTORS_BATCH_MAX } from "@/lib/unions/organizeSectorEconomy";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const organizeSectorsSchema = z.object({
  sectorIds: z
    .array(schemas.objectId)
    .min(1)
    .max(ORGANIZE_SECTORS_BATCH_MAX)
    .refine((ids) => new Set(ids).size === ids.length, "Each sector can only be listed once."),
});

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    if (!(await isLabourFullMode())) {
      return errorResponse(403, "Player-run unions are not enabled.");
    }

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, organizeSectorsSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }

    const { id } = await params;
    const db = await getDb();

    const results: Array<
      | ({ sectorId: string; ok: true } & Record<string, unknown>)
      | { sectorId: string; ok: false; error: string }
    > = [];
    let stopped: { sectorId: string; status: number; error: string } | null = null;

    for (const sectorId of parsed.data.sectorIds) {
      // Re-read the character every drive: the command checks the action
      // balance on the document it is handed, and the previous drive spent one.
      const character = await getCharacterByUserId(db, auth.user.userId);
      if (!character) {
        return errorResponse(404, "Character not found");
      }
      const result = await organizeSector(db, character, id, sectorId);
      if (!result.ok) {
        results.push({ sectorId, ok: false, error: result.error });
        stopped = { sectorId, status: result.status, error: result.error };
        break;
      }
      const { ok: _ok, status: _status, ...payload } = result;
      results.push({ sectorId, ok: true, ...payload });
    }

    const completed = results.filter((r) => r.ok).length;
    // Nothing landed: answer with the refusal itself, exactly like the
    // single-sector route, so the client shows the real reason.
    if (completed === 0 && stopped) {
      return errorResponse(stopped.status, stopped.error);
    }
    return NextResponse.json({
      success: true,
      completed,
      requested: parsed.data.sectorIds.length,
      stopped,
      results,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
