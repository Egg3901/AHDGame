import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter, type AuthUserWithCharacter } from "@/lib/auth"; // Optional auth - intentionally uses getAuthUserWithCharacter()
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { conditionalJson } from "@/lib/api/conditionalJson";
import { openFieldOffice } from "@/lib/campaigns/fieldOffices/commands";
import { getFieldOfficeView } from "@/lib/campaigns/fieldOffices/queries";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const REGION_RE = /^[A-Z0-9_]{2,12}$/i;

// GET /api/campaigns/[id]/field-offices?region=PA - Field offices, the region list, and the
// county lean map for one region. Office locations are public; costs, yields and marginal
// value are only returned to the campaign's managers and nominee.
// Auth: public
// Errors: 400, 404
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) return errorResponse(400, "Invalid campaign ID");
    const region = new URL(request.url).searchParams.get("region");
    if (region && !REGION_RE.test(region)) return errorResponse(400, "Invalid region");

    let user: AuthUserWithCharacter | null = null;
    try {
      user = await getAuthUserWithCharacter();
    } catch {
      // Anonymous: public view.
    }
    const db = await getDb();
    const view = await getFieldOfficeView(db, new ObjectId(id), user, region);
    return conditionalJson(request, { fieldOffices: view });
  } catch (error) {
    return handleRouteError(error);
  }
}

const openSchema = z.object({
  regionId: z.string().regex(REGION_RE),
  subdivisionId: z
    .string()
    .regex(/^[0-9A-Z_-]{1,12}$/i)
    .nullish(),
});

// POST /api/campaigns/[id]/field-offices - Open a field office in a region (and county, where
// the country maps counties).
// Auth: requireAuthWithCharacter (campaign manager or nominee)
// Errors: 400, 401, 403, 404, 409, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) return errorResponse(400, "Invalid campaign ID");
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const parsed = await parseJsonBody(request, openSchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);

    const db = await getDb();
    const result = await openFieldOffice({
      db,
      campaignId: new ObjectId(id),
      user: auth.user,
      regionId: parsed.data.regionId,
      subdivisionId: parsed.data.subdivisionId ?? null,
    });
    return NextResponse.json({
      success: true,
      officeId: result.office._id.toString(),
      funds: result.funds,
      actions: result.actions,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
