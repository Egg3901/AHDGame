/**
 * POST /api/admin/uk/government/appoint-pm — Admin appoints or vacates a PM.
 *
 * Accepts optional countryId in body (defaults to "UK" for backwards compat).
 * Only updates the governmentFormations collection (new system).
 * Auth: requireAdmin
 * Errors: 400, 403, 404
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { COUNTRY_CONFIGS, type CountryId, isParliamentarySystem } from "@/lib/constants/countries";
import { adminAppointPrimeMinister } from "@/lib/government/commands/appointments";

const schema = z.object({
  characterId: z.string().nullable(),
  countryId: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);

    const countryId = (parsed.data.countryId?.toUpperCase() ?? "UK") as CountryId;
    const countryConfig = COUNTRY_CONFIGS[countryId];
    if (!countryConfig) {
      return errorResponse(400, "Invalid country code");
    }
    if (!isParliamentarySystem(countryConfig)) {
      return errorResponse(400, "This country does not use parliamentary PM appointment");
    }

    const db = await getDb();
    return NextResponse.json(
      await adminAppointPrimeMinister(
        db,
        auth.admin.username,
        countryId,
        countryConfig,
        parsed.data.characterId
      )
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
