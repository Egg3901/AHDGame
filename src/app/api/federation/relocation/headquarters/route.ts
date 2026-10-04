import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { countryIdSchema } from "@/lib/api/schemas/country";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { getCountryAccess } from "@/lib/countryAccess";
import { getDb } from "@/lib/mongodb";
import { chooseFederationFirmHeadquarters } from "@/lib/world/succession/chooseFirmHeadquarters";

const bodySchema = z.object({
  applicationId: z.string().min(1),
  corporationId: z.string().regex(/^[a-f\d]{24}$/i),
  targetCountryId: countryIdSchema,
  targetStateId: z.string().min(1),
});

/** The owner selects a playable HQ for a firm protected by federation succession.
 * No relocation fee is charged: affected local facilities already became
 * compensation claims in the ratified settlement. */
export async function POST(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const rateLimit = checkRateLimit(auth.user.userId, 10, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const access = await getCountryAccess(parsed.data.targetCountryId);
    if (!access.enabledForPlayers)
      return NextResponse.json({ error: "That country is not playable." }, { status: 403 });
    const db = await getDb();
    const hold = await chooseFederationFirmHeadquarters({
      db,
      applicationId: parsed.data.applicationId,
      corporationId: parsed.data.corporationId,
      ownerUserId: auth.user.userId,
      destination: {
        countryId: parsed.data.targetCountryId,
        stateId: parsed.data.targetStateId,
      },
      now: new Date(),
    });
    return NextResponse.json({ ok: true, hold });
  } catch (error) {
    if (error instanceof Error && /not owned or pending/.test(error.message))
      return NextResponse.json({ error: error.message }, { status: 403 });
    if (
      error instanceof Error &&
      /choice|destination|settlement|exchange rates|live currency|not playable|changed/.test(
        error.message
      )
    )
      return NextResponse.json({ error: error.message }, { status: 409 });
    return handleRouteError(error, { route: "POST /api/federation/relocation/headquarters" });
  }
}
