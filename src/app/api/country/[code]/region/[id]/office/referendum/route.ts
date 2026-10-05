import { z } from "zod";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse, statusResponse } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { canManageOffice } from "@/lib/governorOffice/access";
import { requestReferendum } from "@/lib/referendum/requestReferendum";

// POST /api/country/[code]/region/[id]/office/referendum
// Auth: requireHumanSessionWithCharacter; must be the office-holder (FM) or an
//   authorized party officer of an NPP-held office, for SCO/WAL/NIR. Admins may
//   request via adminOverride.
// Errors: 400, 401, 403
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country");
    }
    if (countryId !== "UK") {
      return errorResponse(400, "Referendums are UK-only.");
    }

    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;

    const stateId = id.toUpperCase();
    const db = await getDb();

    const parsed = await parseJsonBody(
      request,
      z.object({ adminOverride: z.boolean().optional() })
    );
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }

    const isAdmin = auth.user.isAdmin === true;
    const adminOverride = parsed.data.adminOverride === true && isAdmin;
    const canManage = await canManageOffice(db, countryId, stateId, auth.user.character._id);
    if (!canManage && !adminOverride) {
      return errorResponse(403, "Not authorized for this office");
    }

    const result = await requestReferendum(db, { countryId, stateId, adminOverride });
    return statusResponse(result.status, result.body);
  } catch (error) {
    return handleRouteError(error);
  }
}
