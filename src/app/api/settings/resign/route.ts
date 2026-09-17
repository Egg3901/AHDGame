import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { resignPosition } from "@/lib/settings/resignations";

const resignSchema = z.object({ positionId: z.string().min(1).max(200) }).strict();

// POST /api/settings/resign — Resigns the authenticated character from one position.
export async function POST(request: Request) {
  try {
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(authResult.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, resignSchema);
    if (!parsed.success) {
      return NextResponse.json(badRequest(parsed.error).toJson(), { status: parsed.status });
    }
    const { positionId } = parsed.data;

    const db = await getDb();
    const result = await resignPosition(db, authResult.user.character, positionId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      message: `You have resigned from ${result.label}.`,
      position: result.label,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
