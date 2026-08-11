import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { z } from "zod";
import type { State, StatePartyOrg } from "@/lib/db/types";
import { findPartyBySequentialId, getStatePartyOrgDocumentId } from "@/lib/db/partyLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";

const heroSchema = z.object({
  heroImageUrl: z
    .string()
    .url("Invalid hero image URL")
    .refine((url) => url.startsWith("http://") || url.startsWith("https://"), {
      message: "Hero image URL must use http or https",
    })
    .optional(),
});

// POST /api/country/[code]/region/[id]/party/[partyId]/hero — Update the hero image for the state party page
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string; partyId: string }> }
) {
  try {
    const { code, id, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const stateId = id;
    const parsed = await parseJsonBody(request, heroSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const { heroImageUrl } = parsed.data;

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const authData = auth.user;

    const db = await getDb();
    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const orgId = getStatePartyOrgDocumentId(stateId, party);
    const statePartyOrg = await db.collection<StatePartyOrg>("statePartyOrg").findOne({
      _id: orgId,
    });

    if (!statePartyOrg) {
      // Create if doesn't exist? Usually it should exist if they are chair.
      // But maybe we should just return 404.
      return NextResponse.json({ error: "State party not found" }, { status: 404 });
    }

    const isChair = statePartyOrg.chairId?.toString() === authData.character._id.toString();
    const isAdmin = authData.isAdmin;

    if (!isChair && !isAdmin) {
      return NextResponse.json(
        { error: "Only the state party chair can update the hero image" },
        { status: 403 }
      );
    }

    await db
      .collection<StatePartyOrg>("statePartyOrg")
      .updateOne({ _id: orgId }, { $set: { heroImageUrl } });

    return NextResponse.json({ message: "Hero image updated successfully" });
  } catch (error) {
    return handleRouteError(error);
  }
}
