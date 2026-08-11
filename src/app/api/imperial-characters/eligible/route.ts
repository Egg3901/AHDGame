import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getImperialEligibleCountries } from "@/lib/imperial";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { ImperialCharacter } from "@/lib/db/types/imperialCharacter";

/**
 * GET /api/imperial-characters/eligible — List countries available for imperial character creation.
 * Auth: requireAdmin().
 * Errors: 403 (not admin).
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const eligible = getImperialEligibleCountries();

    // Find which countries already have imperial characters
    const existing = await db
      .collection<ImperialCharacter>("imperialCharacters")
      .find({ countryId: { $in: eligible } })
      .project({ countryId: 1 })
      .toArray();

    const taken = new Set(existing.map((e) => e.countryId));

    const available = eligible
      .filter((id) => !taken.has(id))
      .map((id) => ({
        countryId: id,
        name: COUNTRY_CONFIGS[id].name,
        titles: COUNTRY_CONFIGS[id].imperialTitles,
      }));

    return NextResponse.json({ countries: available });
  } catch (error) {
    return handleRouteError(error);
  }
}
