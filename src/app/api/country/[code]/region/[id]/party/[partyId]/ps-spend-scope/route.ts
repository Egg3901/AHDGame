import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { StatePartyOrg } from "@/lib/db/types";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { isSameCountry } from "@/lib/api/sameCountry";
import { CROSS_COUNTRY_ACTION_MESSAGE } from "@/lib/api/crossCountryGuard";
import { resolveSpenderScopeEligibility } from "@/lib/parties/access";

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string }>;
}

/**
 * GET /api/country/[code]/region/[id]/party/[partyId]/ps-spend-scope —
 * read-only, side-effect-free. Answers "which PS pools may this viewer spend
 * from for Build Org / Contest in this state, and how much is in each pool".
 *
 * Unlike the action-preview routes, this does NOT short-circuit on
 * presence / headroom / target — so the Build Org and Contest cards can rely
 * on it to decide whether to render the dual State/National pool buttons (the
 * only case being a character who holds both a national and a state role).
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { code, id: regionId, partyId } = await params;
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) {
    return NextResponse.json({ ok: false, reason: "auth", message: "Invalid country code" });
  }

  const authResult = await requireAuthWithCharacter();
  if (!authResult.ok) return authResult.response;
  const authUser = authResult.user;

  // Cross-country guard (Bug #0668): party sequentialId is unique per country,
  // so a foreign viewer's party id collides onto the same-id local party.
  if (!isSameCountry(authUser.character, { countryId })) {
    return NextResponse.json({
      ok: false,
      reason: "cross-country",
      message: CROSS_COUNTRY_ACTION_MESSAGE,
    });
  }

  const upperRegionId = regionId.toUpperCase();
  const db = await getDb();

  const spenderParty = await findPartyBySequentialId(db, partyId, countryId);
  if (!spenderParty) {
    return NextResponse.json({ ok: false, reason: "missing-row", message: "Party not found" });
  }

  const spenderRow = await db.collection<StatePartyOrg>("statePartyOrg").findOne({
    countryId,
    stateId: upperRegionId,
    partyId: String(spenderParty.sequentialId),
  });

  const eligibleScopes = resolveSpenderScopeEligibility(spenderParty, spenderRow, authUser);

  return NextResponse.json({
    ok: true,
    eligibleScopes,
    statePoolPS: spenderRow?.politicalStrength ?? 0,
    nationalPoolPS: spenderParty.politicalStrength ?? 0,
  });
}
