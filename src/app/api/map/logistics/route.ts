// GET ?countryId=US
// Per-state freight (logistics) demand for the map choropleth. Reads the latest
// `sourcingNetworkLoad` ledger written by the interstate landed-price sourcing
// pass (runs when the market is in `ledger` mode or above). Freight consumed per
// state is the "where is logistics demand highest" signal players asked for.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { ZOD_COUNTRY_ENUM, type CountryId } from "@/lib/constants/countries";
import type { SourcingNetworkDoc } from "@/lib/logistics/sourcingLedger";

const countryIdSchema = z.enum(ZOD_COUNTRY_ENUM);

export type FreightDemandEntry = {
  bulk: number;
  special: number;
  total: number;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const countryIdRaw = searchParams.get("countryId");

    if (!countryIdRaw) throw badRequest("countryId required");
    const countryIdParsed = countryIdSchema.safeParse(countryIdRaw);
    if (!countryIdParsed.success) throw badRequest("Invalid countryId");
    const countryId: CountryId = countryIdParsed.data;

    const db = await getDb();

    // Latest ledger turn, plus the country's own state ids so freight from other
    // countries' states never bleeds into this map.
    const [latest, countryStates] = await Promise.all([
      db
        .collection<SourcingNetworkDoc>("sourcingNetworkLoad")
        .find({})
        .sort({ turn: -1 })
        .limit(1)
        .toArray(),
      db
        .collection<{ _id: string }>("states")
        .find({ countryId }, { projection: { _id: 1 } })
        .toArray(),
    ]);

    const networkDoc = latest[0];
    const stateIds = new Set(countryStates.map((s) => s._id));

    const states: Record<string, FreightDemandEntry> = {};
    if (networkDoc) {
      for (const [stateId, used] of Object.entries(networkDoc.freightTeuByState)) {
        if (!stateIds.has(stateId)) continue;
        const bulk = used.bulk ?? 0;
        const special = used.special ?? 0;
        states[stateId] = { bulk, special, total: bulk + special };
      }
    }

    return NextResponse.json({
      countryId,
      turn: networkDoc?.turn ?? null,
      states,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
