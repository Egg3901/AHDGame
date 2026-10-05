import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { countryIdSchema } from "@/lib/api/schemas/country";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { getDb, getMongoClient } from "@/lib/mongodb";
import { chooseFederationResidentHome } from "@/lib/world/succession/chooseResidentHome";

const bodySchema = z.object({
  applicationId: z.string().min(1),
  targetCountryId: countryIdSchema,
  targetStateId: z.string().min(1),
});

/** Explicit, no-fee playable residence choice after a federation split. */
export async function POST(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const rateLimit = checkRateLimit(auth.user.userId, 10, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const db = await getDb();
    const client = await getMongoClient();
    const session = client.startSession();
    try {
      const hold = await session.withTransaction(() =>
        chooseFederationResidentHome({
          db,
          session,
          applicationId: parsed.data.applicationId,
          characterId: auth.user.character._id.toString(),
          ownerUserId: auth.user.userId,
          destination: {
            countryId: parsed.data.targetCountryId,
            stateId: parsed.data.targetStateId,
          },
        })
      );
      return NextResponse.json({ ok: true, hold });
    } finally {
      await session.endSession();
    }
  } catch (error) {
    if (error instanceof Error && /not owned or pending/.test(error.message))
      return errorResponse(403, error.message);
    if (
      error instanceof Error &&
      /choice|destination|settlement|changed|relocation/.test(error.message)
    )
      return errorResponse(409, error.message);
    return handleRouteError(error, { route: "POST /api/federation/relocation/residence" });
  }
}
