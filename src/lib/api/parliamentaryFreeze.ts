/**
 * Freeze gate (S#17): returns {ok: false} when a parliamentary country's
 * government is currently `pending` (awaiting PM formation). Used at bill
 * proposal / modification / cabinet-action route entry points and in
 * turn-phase bill-lifecycle processors.
 *
 * Non-parliamentary countries (US, CA) always pass through.
 * Parliamentary countries with no formation doc also pass through (first
 * boot / unseeded countries).
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { COUNTRY_CONFIGS, isParliamentarySystem, type CountryId } from "@/lib/constants/countries";
import { badRequest } from "@/lib/api/errors";

export async function checkLegislationFreeze(
  countryId: CountryId
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  if (!isParliamentarySystem(COUNTRY_CONFIGS[countryId])) {
    return { ok: true };
  }

  const db = await getDb();
  const gov = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  if (gov?.status === "pending") {
    return {
      ok: false,
      response: NextResponse.json(
        badRequest(
          "Government is in formation; legislation is frozen until a PM is seated"
        ).toJson(),
        { status: 400 }
      ),
    };
  }

  return { ok: true };
}
