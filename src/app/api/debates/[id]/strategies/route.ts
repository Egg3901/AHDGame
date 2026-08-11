import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { badRequest, handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { submitDebateStrategies } from "@/lib/debate/debateSessionLifecycle";
import { DEBATE_STRATEGIES } from "@/lib/debate/debateScoring";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const bodySchema = z.object({
  // Debates are one-pick: exactly one strategy per side.
  strategies: z
    .array(z.enum(DEBATE_STRATEGIES as unknown as [string, ...string[]]))
    .length(1, "Pick exactly one strategy"),
});

// POST /api/debates/[id]/strategies — submit the caller's debate strategy picks.
// Resolves immediately if both sides are now ready. Auth: human + character.
// Errors: 400, 401, 403, 404, 409, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) throw badRequest("Invalid debate id");

    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const result = await submitDebateStrategies(
      db,
      new ObjectId(id),
      auth.user.character._id,
      parsed.data.strategies as (typeof DEBATE_STRATEGIES)[number][],
      new Date()
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      resolved: result.resolved,
      outcome: result.resolved ? (result.session.outcome ?? null) : null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
