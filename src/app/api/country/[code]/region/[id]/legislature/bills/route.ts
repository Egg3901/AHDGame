import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { proposeStateBill } from "@/lib/legislature/commands/proposeStateBill";
import { listStateLegislatureBills } from "@/lib/legislature/queries/stateBillQueries";
import { STATE_BILL_CATEGORIES, MAX_PROVISIONS } from "@shared/constants/legislation";
import { moderatedBillTitle, moderatedBillText } from "@/lib/api/schemas/congress";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";

// GET /api/country/[code]/region/[id]/legislature/bills — Return state bills for a region.
// Auth: public
// Errors: 400
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const [db, authUser] = await Promise.all([getDb(), getAuthUser().catch(() => null)]);
    const response = await listStateLegislatureBills(db, {
      countryId,
      stateId: id,
      authUser,
    });

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/country/[code]/region/[id]/legislature/bills — Propose a state bill.
// Auth: requireAuth
// Errors: 400, 401, 403, 409, 429
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

    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const subsidyProvisionSchema = z.object({
      type: z.literal("subsidy"),
      scopeType: z.enum(["economy_wide", "sector"]),
      targetSectorType: z.string().optional(),
      targetStrategyId: z.string().optional(),
      domesticOnly: z.boolean(),
    });
    const endSubsidyProvisionSchema = z.object({
      type: z.literal("end_subsidy"),
      scopeType: z.enum(["economy_wide", "sector"]),
      targetSectorType: z.string().optional(),
      targetStrategyId: z.string().optional(),
    });
    const policyProvisionSchema = z.object({
      legislationTypeId: z.string().optional(),
      policyOptionId: z.string().optional(),
      effectDirection: z.number().optional(),
      economic: z.number().optional(),
      social: z.number().optional(),
    });

    const billSchema = z.object({
      title: moderatedBillTitle(),
      summary: moderatedBillText(z.string().min(1, "Summary required")),
      category: z.enum(STATE_BILL_CATEGORIES).optional(),
      legislationTypeId: z.string().optional(),
      effectDirection: z.number().optional(),
      provisions: z
        .array(z.union([subsidyProvisionSchema, endSubsidyProvisionSchema, policyProvisionSchema]))
        .max(MAX_PROVISIONS)
        .optional(),
      adminOverride: z.boolean().optional(),
    });

    const parsed = await parseJsonBody(request, billSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const result = await proposeStateBill(db, countryId, id, auth.user, parsed.data);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}
