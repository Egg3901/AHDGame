// POST /api/country/[code]/pm/snap-election — PM triggers a snap election (dissolves lower house)
// Auth: requireAuthWithCharacter (must be sitting PM)
// Error codes: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import {
  assertSnapElectionsAllowed,
  getParliamentaryCountryId,
} from "@/lib/government/parliamentaryCountry";
import { triggerPrimeMinisterSnapElection } from "@/lib/government/commands/parliamentaryGovernment";

export async function POST(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = getParliamentaryCountryId(code);
    assertSnapElectionsAllowed(countryId);

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    return NextResponse.json(
      await triggerPrimeMinisterSnapElection(db, countryId, auth.user.character)
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
