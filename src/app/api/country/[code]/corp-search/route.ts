// GET /api/country/[code]/corp-search?q=...
// Name search over private/NPC corporations HQ'd in the country, for the bill
// nationalize target picker (legislative full reach). Excludes state-owned corps.
// Auth: public read. Errors: 400
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Corporation } from "@/lib/db/types";
import { escapeRegex } from "@/lib/utils/escapeRegex";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) return NextResponse.json({ results: [] });

    const db = await getDb();
    const rows = await db
      .collection<Corporation>("corporations")
      .find({
        countryId,
        countryOwnerId: { $exists: false },
        name: { $regex: escapeRegex(q), $options: "i" },
      })
      .limit(10)
      .toArray();

    const results = rows
      .filter((c) => !isStateOwned(c))
      .map((c) => ({ id: String(c._id), name: c.name, ticker: c.tickerSymbol ?? null }));
    return NextResponse.json({ results });
  } catch (error) {
    return handleRouteError(error);
  }
}
