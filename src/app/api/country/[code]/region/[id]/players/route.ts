import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { State } from "@/lib/db/types";
import {
  getStateRoster,
  STATE_ROSTER_DEFAULT_PAGE_SIZE,
  type StateRosterResult,
} from "@/lib/states/overview/getStateRoster";

export type { StateRosterResult, StateRosterRow } from "@/lib/states/overview/getStateRoster";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

// GET /api/country/[code]/region/[id]/players?page=1&pageSize=20
// Paginated roster (influence desc) of every player whose character calls
// this state home. Powers the Overview tab's Player Roster table.
// Auth: public
// Errors: 400, 404
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const stateId = id;

    const db = await getDb();
    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.max(
      1,
      parseInt(url.searchParams.get("pageSize") ?? String(STATE_ROSTER_DEFAULT_PAGE_SIZE), 10) ||
        STATE_ROSTER_DEFAULT_PAGE_SIZE
    );

    const result: StateRosterResult = await getStateRoster(db, {
      countryId,
      stateId,
      page,
      pageSize,
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
