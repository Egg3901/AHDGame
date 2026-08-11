import { NextResponse } from "next/server";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { z } from "zod";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import type { PoliticalParty } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { canActAsChair } from "@/lib/parties/actingChair";

const heroSchema = z.object({
  heroImageUrl: z
    .string()
    .url("Invalid hero image URL")
    .refine((url) => url.startsWith("http://") || url.startsWith("https://"), {
      message: "Hero image URL must use http or https",
    })
    .optional(),
});

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
    const parsed = await parseJsonBody(request, heroSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const { heroImageUrl } = parsed.data;

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(authResult.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const authData = authResult.user;

    const db = await getDb();

    const party = await findPartyBySequentialId(db, id, countryId);

    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const isAdmin = authData.isAdmin;

    if (!canActAsChair(party, authData.character._id) && !isAdmin) {
      return NextResponse.json(
        {
          error:
            "Only the party chair (or acting vice-chair when the chair seat is vacant) can update the hero image",
        },
        { status: 403 }
      );
    }

    await db
      .collection<PoliticalParty>("politicalParties")
      .updateOne({ _id: party._id }, { $set: { heroImageUrl } });

    return NextResponse.json({ message: "Hero image updated successfully" });
  } catch (error) {
    return handleRouteError(error);
  }
}
