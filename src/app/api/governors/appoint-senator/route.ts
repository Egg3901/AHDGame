import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { appointSenator } from "@/lib/government/commands/appointments";

const schema = z
  .object({
    appointeeId: z.string().length(24).optional(),
    characterId: z.string().length(24).optional(),
    appointeeType: z.enum(["character", "npp"]).default("character"),
    senateClass: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
  .refine((data) => data.appointeeId || data.characterId, {
    message: "appointeeId is required",
    path: ["appointeeId"],
  });

// POST /api/governors/appoint-senator - Allows a governor to appoint a player or NPP to a vacant Senate seat in their state.
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 429
export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    return NextResponse.json(await appointSenator(db, auth.user.userId, parsed.data));
  } catch (error) {
    return handleRouteError(error);
  }
}
