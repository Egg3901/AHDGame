import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { castStateBillOverrideVote } from "@/lib/legislature/commands/stateBillActions";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";

// POST /api/country/[code]/region/[id]/legislature/bills/[billId]/override-vote — Cast a veto override vote.
// Auth: requireAuth
// Errors: 400, 401, 403, 404, 409, 429
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string; billId: string }> }
) {
  try {
    const { code, id, billId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, z.object({ vote: z.enum(["for", "against"]) }));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const result = await castStateBillOverrideVote(
      db,
      countryId,
      id,
      billId,
      auth.user,
      parsed.data.vote
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}
