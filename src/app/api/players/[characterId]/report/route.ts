import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import {
  PLAYER_REPORT_CONTEXTS,
  PLAYER_REPORT_REASONS,
  reportPlayer,
} from "@/lib/safety/playerSafety";

const reportSchema = z.object({
  reason: z.enum(PLAYER_REPORT_REASONS as [string, ...string[]]),
  context: z.enum(PLAYER_REPORT_CONTEXTS as [string, ...string[]]).default("profile"),
  details: z.string().max(1000).optional(),
});

// POST /api/players/[characterId]/report — Report a player's content to moderators
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 409, 429
export async function POST(
  request: Request,
  { params }: { params: Promise<{ characterId: string }> }
) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const limit = checkRateLimit(`player-report:${auth.user.userId}`, 10, 60 * 60_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const parsed = await parseJsonBody(request, reportSchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);

    const { characterId } = await params;
    const db = await getDb();
    await reportPlayer(db, auth.user.userId, characterId, {
      reason: parsed.data.reason as (typeof PLAYER_REPORT_REASONS)[number],
      context: parsed.data.context as (typeof PLAYER_REPORT_CONTEXTS)[number],
      details: parsed.data.details,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
