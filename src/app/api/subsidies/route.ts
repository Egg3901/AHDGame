/**
 * GET /api/subsidies?countryId=US — Returns all active subsidies for a country.
 * Also accepts ?countryIds=US,JP to fetch multiple countries in a single request
 * (used by the corporation page when a corp operates across borders, replacing
 * an N+1 fan-out of one request per country).
 * Auth: public
 * Errors: 400
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import type { Subsidy } from "@/lib/db/types";
import { ALL_COUNTRY_IDS, type CountryId } from "@/lib/constants/countries";

const COUNTRY_SET = new Set<string>(ALL_COUNTRY_IDS);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const single = searchParams.get("countryId");
    const multi = searchParams.get("countryIds");

    const requested = new Set<string>();
    if (single) requested.add(single);
    if (multi) {
      for (const part of multi.split(",")) {
        const trimmed = part.trim();
        if (trimmed) requested.add(trimmed);
      }
    }

    if (requested.size === 0) {
      return NextResponse.json({ error: "Missing countryId or countryIds" }, { status: 400 });
    }
    for (const id of requested) {
      if (!COUNTRY_SET.has(id)) {
        return NextResponse.json({ error: `Invalid countryId: ${id}` }, { status: 400 });
      }
    }
    const countryIds = Array.from(requested) as CountryId[];

    const db = await getDb();
    const subsidies = await db
      .collection<Subsidy>("subsidies")
      .find({ countryId: { $in: countryIds }, active: true })
      .sort({ scope: 1, scopeType: 1, createdAt: 1 })
      .toArray();

    return NextResponse.json({
      subsidies: subsidies.map((s) => ({
        id: s._id.toString(),
        countryId: s.countryId,
        scope: s.scope,
        stateId: s.stateId ?? null,
        scopeType: s.scopeType,
        targetSectorType: s.targetSectorType ?? null,
        targetStrategyId: s.targetStrategyId ?? null,
        domesticOnly: s.domesticOnly,
        sourceBillId: s.sourceBillId.toString(),
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
