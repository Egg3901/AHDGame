import { z } from "zod";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse, statusResponse } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";
import { grantReferendum } from "@/lib/referendum/grantReferendum";

// POST /api/country/[code]/referendum/[refId]/submit
// Auth: requireHumanSessionWithCharacter; must be the sitting UK Prime Minister
//   (or an admin via adminOverride). The PM grants or declines a requested
//   referendum (no Commons consent vote — Westminster's bill comes at conversion).
// Errors: 400, 401, 403, 404
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; refId: string }> }
) {
  try {
    const { code, refId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country");
    }
    if (countryId !== "UK") {
      return errorResponse(400, "Referendums are UK-only.");
    }

    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const parsed = await parseJsonBody(
      request,
      z.object({
        action: z.union([z.literal("grant"), z.literal("decline")]).default("grant"),
        adminOverride: z.boolean().optional(),
      })
    );
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }

    const isAdmin = auth.user.isAdmin === true;
    const adminOverride = parsed.data.adminOverride === true && isAdmin;
    const pmId = await getHeadOfGovernmentCharacterId(db, countryId);
    const isPM = pmId != null && pmId.equals(auth.user.character._id);

    const result = await grantReferendum(db, {
      countryId,
      referendumId: refId,
      isPM,
      action: parsed.data.action,
      adminOverride,
    });
    return statusResponse(result.status, result.body);
  } catch (error) {
    return handleRouteError(error);
  }
}
