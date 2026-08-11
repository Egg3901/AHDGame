// GET /api/country/[code]/corp-sectors?corporationId=...
// Sectors of a (non-state-owned) corporation HQ'd in the country, for the bill
// sector-target nationalize picker. Auth: public read. Errors: 400
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Corporation, CorporateSector } from "@/lib/db/types";
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
    const corpIdParam = new URL(request.url).searchParams.get("corporationId") ?? "";
    if (!ObjectId.isValid(corpIdParam)) return NextResponse.json({ sectors: [] });

    const db = await getDb();
    const corp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: new ObjectId(corpIdParam) });
    if (!corp || corp.countryId !== countryId || isStateOwned(corp)) {
      return NextResponse.json({ sectors: [] });
    }
    const sectors = await db
      .collection<CorporateSector>("corporateSectors")
      .find({ corporationId: corp._id, countryId })
      .toArray();
    return NextResponse.json({
      sectors: sectors.map((s) => ({
        sectorId: String(s._id),
        sectorType: s.sectorType,
        stateId: s.stateId,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
