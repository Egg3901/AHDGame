// POST /api/admin/corporations/spawn-npp
// Admin-only: spawn an NPP-run corporation with AI CEO.
// The NPP CEO holds 51% of shares; 49% is in public float (purchasable by players).
// Auth: requireAdmin
// Errors: 401, 403, 400, 404, 409

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { spawnNppCorporation } from "@/lib/admin/spawnNppCorporation";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";

const spawnSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(CORPORATION_TYPES),
  countryId: z.string().min(1).max(5),
  headquartersState: z.string().min(1).max(20),
  startingCapital: z.number().int().min(0).optional(),
  startingRevenue: z.number().int().min(0).optional(),
  profitMargin: z.number().min(0).max(100).optional(),
  brandColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
});

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, spawnSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();

    // Validate countryId is a known CountryId
    const validCountryIds: CountryId[] = ["US", "UK", "DE", "JP", "IE", "BR", "CN", "NG"];
    if (!validCountryIds.includes(parsed.data.countryId as CountryId)) {
      return NextResponse.json(
        { error: `Invalid countryId: ${parsed.data.countryId}` },
        { status: 400 }
      );
    }

    const result = await spawnNppCorporation(db, {
      ...parsed.data,
      countryId: parsed.data.countryId as CountryId,
    });

    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}
