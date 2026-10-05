// POST /api/admin/corporations/spawn-npp-batch
// Admin-only: batch spawn NPP-run corporations for a country.
// Spawns one corporation per sector type (up to 18) in the country's capital state.
// Auth: requireAdmin
// Errors: 403, 400

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { batchSpawnNppCorporations } from "@/lib/admin/spawnNppCorporation";
import type { CountryId } from "@/lib/constants/countries";
import { OPERATING_SECTOR_TYPES, operatingSectorIdentity } from "@/lib/constants/corporations";

const batchSpawnSchema = z.object({
  countryId: z.string().min(1).max(5),
  headquartersState: z.string().min(1).max(20).optional(),
  startingCapital: z.number().int().min(0).optional(),
  sectorTypes: z.array(z.enum(OPERATING_SECTOR_TYPES)).optional(),
});

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, batchSpawnSchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);

    const db = await getDb();

    // Validate countryId
    const validCountryIds: CountryId[] = ["US", "UK", "DE", "JP", "IE", "BR", "CN", "NG"];
    if (!validCountryIds.includes(parsed.data.countryId as CountryId)) {
      return errorResponse(400, `Invalid countryId: ${parsed.data.countryId}`);
    }

    const results = await batchSpawnNppCorporations(db, parsed.data.countryId as CountryId, {
      headquartersState: parsed.data.headquartersState,
      startingCapital: parsed.data.startingCapital,
      sectorMarkets: parsed.data.sectorTypes?.map((lane) => {
        const identity = operatingSectorIdentity(lane);
        return {
          type: identity.sectorType,
          industryModel: identity.industryModel,
          mediaDiscriminator: identity.mediaDiscriminator,
        };
      }),
    });

    return NextResponse.json(
      {
        success: true,
        spawned: results.length,
        corporations: results,
      },
      { status: 201 }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
