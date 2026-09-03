import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { isSameCountry } from "@/lib/api/sameCountry";
import { CROSS_COUNTRY_ACTION_MESSAGE } from "@/lib/api/crossCountryGuard";
import { computeBuildOrgPreview } from "@/lib/turn/politicalStrength/computeBuildOrgPreview";

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string }>;
}

/**
 * GET /api/country/[code]/region/[id]/party/[partyId]/build-org/preview —
 * read-only endpoint returning the effective cost, projected gain, and 4-factor
 * breakdown the POST route would produce, without mutating any collection. The
 * projection itself lives in the shared `computeBuildOrgPreview` helper — the
 * SAME helper the POST route uses to return the next-click estimate — so the
 * pre-click preview can never drift from the post-click charge/gain.
 */
export async function GET(request: Request, { params }: RouteParams) {
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
      reason: "auth",
      message: CROSS_COUNTRY_ACTION_MESSAGE,
    });
  }

  const upperRegionId = regionId.toUpperCase();
  const db = await getDb();

  const spenderParty = await findPartyBySequentialId(db, partyId, countryId);
  if (!spenderParty) {
    return NextResponse.json({ ok: false, reason: "missing-row", message: "Party not found" });
  }

  // `?psPool=` lets a caller that already knows which pool it will spend get a
  // quote for THAT tier. The national HQ's bulk tool always posts
  // `psPool: "national"`, and the tier sets both the cash rate and which
  // treasury is checked, so a quote for the wrong tier misprices the click.
  // Ignored where the spender is not eligible for the requested pool.
  const psPool = new URL(request.url).searchParams.get("psPool");
  const preferredScope =
    psPool === "national" ? "national-targeted" : psPool === "state" ? "state" : undefined;

  const result = await computeBuildOrgPreview(db, {
    countryId,
    upperRegionId,
    spenderParty,
    authUser,
    preferredScope,
  });
  return NextResponse.json(result);
}
