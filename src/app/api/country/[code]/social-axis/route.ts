// GET /api/country/[code]/social-axis — country social-axis position (P6b).
// Auth: requireAuth
// Errors: 400 (invalid country code), 401
//
// Returns the country's runtime social-axis position (−5 libertarian …
// +5 authoritarian). Reads countryState (self-healing from the config
// baseline for docs that predate P6b). The National Policy page pairs this
// with a client-side economic lean aggregated from the law records it
// already loads to render the National Outlook strip.

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCountryState } from "@/lib/countryState";

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function GET(_req: Request, { params }: RouteParams) {
  const auth = await requireAuth();
  if (!auth.ok) return auth.response;

  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) {
    return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
  }

  const db = await getDb();
  const state = await getCountryState(db, countryId);
  const socialAxisPosition =
    state.socialAxisPosition ?? COUNTRY_CONFIGS[countryId].socialAxisBaseline ?? 0;

  return NextResponse.json(
    { socialAxisPosition },
    { headers: { "Cache-Control": "no-store, max-age=0, no-transform" } }
  );
}
