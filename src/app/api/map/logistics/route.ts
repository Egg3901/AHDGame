// GET ?countryId=US
// Per-state freight capacity + projected interstate haul load for the Logistics
// map choropleth. Haul TEUs come from `sourcingNetworkLoad` (record-only
// landed-price sourcing pass). Capacity comes from CommodityPrice.stateSupply
// for freight — the TEU logistics sectors actually clear against. Haul alone
// is not the market size (ticket #1039).

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { ZOD_COUNTRY_ENUM, type CountryId } from "@/lib/constants/countries";
import type { SourcingNetworkDoc } from "@/lib/logistics/sourcingLedger";
import type { FreightDemandEntry, FreightDemandResponse } from "@/lib/logistics/types";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";

const countryIdSchema = z.enum(ZOD_COUNTRY_ENUM);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const countryIdRaw = searchParams.get("countryId");

    if (!countryIdRaw) throw badRequest("countryId required");
    const countryIdParsed = countryIdSchema.safeParse(countryIdRaw);
    if (!countryIdParsed.success) throw badRequest("Invalid countryId");
    const countryId: CountryId = countryIdParsed.data;

    const db = await getDb();

    // Latest ledger turn, country's state ids, and freight capacity by state.
    const [latest, countryStates, freightPrice] = await Promise.all([
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
      db.collection<CommodityPrice>("commodityPrices").findOne({ commodity: "freight" }),
    ]);

    const networkDoc = latest[0];
    const stateIds = new Set(countryStates.map((s) => s._id));
    const stateSupply = freightPrice?.stateSupply ?? {};

    const states: Record<string, FreightDemandEntry> = {};

    // Seed every country state that has freight capacity (even with 0 haul).
    for (const stateId of stateIds) {
      const capacity = Number(stateSupply[stateId] ?? 0);
      if (!(capacity > 0)) continue;
      states[stateId] = { bulk: 0, special: 0, total: 0, capacity };
    }

    if (networkDoc) {
      for (const [stateId, used] of Object.entries(networkDoc.freightTeuByState)) {
        if (!stateIds.has(stateId)) continue;
        const bulk = used.bulk ?? 0;
        const special = used.special ?? 0;
        const capacity = Number(stateSupply[stateId] ?? 0);
        const prev = states[stateId];
        states[stateId] = {
          bulk,
          special,
          total: bulk + special,
          capacity: prev?.capacity ?? capacity,
        };
      }
    }

    const response: FreightDemandResponse = {
      countryId,
      turn: networkDoc?.turn ?? null,
      states,
    };
    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}
