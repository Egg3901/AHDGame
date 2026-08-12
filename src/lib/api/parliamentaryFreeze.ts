/**
 * Freeze gate (S#17): returns {ok: false} when a parliamentary country's
 * government is currently `pending` (awaiting PM formation). Used at bill
 * proposal / cabinet-bill / cabinet-vote / org-proposal route entry points.
 *
 * The rule itself lives in `@/lib/government/legislationFreeze` so the turn
 * loop (NPP bill sponsorship) can apply the identical test without depending
 * on next/server; this module is only the HTTP wrapper around it.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import type { CountryId } from "@/lib/constants/countries";
import {
  isLegislationFrozen,
  LEGISLATION_FREEZE_MESSAGE,
} from "@/lib/government/legislationFreeze";
import { badRequest } from "@/lib/api/errors";

export async function checkLegislationFreeze(
  countryId: CountryId
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const db = await getDb();
  if (!(await isLegislationFrozen(db, countryId))) {
    return { ok: true };
  }

  return {
    ok: false,
    response: NextResponse.json(badRequest(LEGISLATION_FREEZE_MESSAGE).toJson(), { status: 400 }),
  };
}
