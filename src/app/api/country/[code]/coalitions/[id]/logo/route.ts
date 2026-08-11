import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, forbidden, notFound } from "@/lib/api/errors";
import type { Coalition } from "@/lib/db/types/coalition";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";

const logoSchema = z.object({
  logoUrl: z
    .string()
    .url()
    .refine((u) => u.startsWith("http://") || u.startsWith("https://"), "Must use http(s)"),
});

// POST /api/coalitions/[id]/logo?country= — Upload coalition logo
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(authResult.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const { character } = authResult.user;

    const parsed = await parseJsonBody(request, logoSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { logoUrl } = parsed.data;

    const db = await getDb();

    const coalition = await db
      .collection<Coalition>("coalitions")
      .findOne({ sequentialId: parseInt(id, 10), countryId });
    if (!coalition) {
      throw notFound("Coalition not found.");
    }

    // Caller must be the coalition chair
    if (!coalition.chairCharacterId || !coalition.chairCharacterId.equals(character._id)) {
      throw forbidden("Only the coalition chair can update the logo.");
    }

    const now = new Date();

    await db
      .collection<Coalition>("coalitions")
      .updateOne({ _id: coalition._id }, { $set: { logoUrl, updatedAt: now } });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
