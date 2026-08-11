import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { takeStateBillGovernorAction } from "@/lib/legislature/commands/stateBillActions";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { VETO_MESSAGE_MIN_LENGTH, VETO_MESSAGE_MAX_LENGTH } from "@/lib/constants/governorOffice";

// POST /api/country/[code]/region/[id]/legislature/bills/[billId]/governor-action — Sign or veto a passed state bill.
// Auth: requireAuth
// Errors: 400, 401, 403, 404, 429
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

    const parsed = await parseJsonBody(
      request,
      z
        .object({
          action: z.enum(["signed", "vetoed"]),
          vetoMessage: z
            .string()
            .min(VETO_MESSAGE_MIN_LENGTH)
            .max(VETO_MESSAGE_MAX_LENGTH)
            .optional(),
        })
        .refine(
          (data) =>
            data.action !== "vetoed" ||
            (data.vetoMessage?.trim().length ?? 0) >= VETO_MESSAGE_MIN_LENGTH,
          {
            message: `A veto requires a public message of at least ${VETO_MESSAGE_MIN_LENGTH} characters.`,
          }
        )
    );
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const result = await takeStateBillGovernorAction(
      db,
      countryId,
      id,
      billId,
      auth.user,
      parsed.data.action,
      parsed.data.vetoMessage
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}
