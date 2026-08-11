/**
 * GET /api/country/[code]/referendums/active
 * Lightweight nav-gate: reports whether a referendum is currently campaigning in
 * this country, so the "Referendums" nav link can show only when relevant. No
 * auth — a boolean about public game state. Fetched on-demand when the nav opens
 * (mirrors the charter-entry gate), so it costs nothing on other page loads.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getReferendumCollection } from "@/lib/db/collections/referendum";
import { handleRouteError } from "@/lib/api/errors";

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) return NextResponse.json({ hasActiveCampaign: false });
    const db = await getDb();
    const count = await getReferendumCollection(db).countDocuments({
      countryId,
      status: "campaigning",
    });
    return NextResponse.json({ hasActiveCampaign: count > 0 });
  } catch (error) {
    return handleRouteError(error);
  }
}
