import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { normalizeMarketFormationSnapshot } from "@/lib/economy/marketFormationSnapshot";
import { computeMarketAccessVisibility } from "@/lib/economy/marketAccessVisibility";
import type { EconomicVitalSigns } from "@/lib/db/types";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";
import type { CommodityType } from "@/lib/constants/commodities";
import type { CommoditySourcingDoc, SourcingNetworkDoc } from "@/lib/logistics/sourcingLedger";
import { getDb } from "@/lib/mongodb";

// The canonical export lives in @/lib/economy/economicVitalSigns, but that
// module pulls the whole snapshot builder (and its heavy dependency graph)
// into this read-only route. The map/logistics route names its collections
// inline for the same reason; keep this mirroring the snapshot collection.
const ECONOMIC_VITAL_SIGNS_COLLECTION = "economicVitalSigns";

const querySchema = z.object({
  turn: z.coerce.number().int().nonnegative().optional(),
});

/**
 * Newest turn that produced either an economic snapshot or a sourcing network
 * doc: the two inputs this view reads. A completed turn writes both, so either
 * is a sound anchor and the fallback only matters on a half-written world.
 */
async function resolveLatestTurn(db: Awaited<ReturnType<typeof getDb>>): Promise<number | null> {
  const vitalSigns = await db
    .collection<{ turn: number }>(ECONOMIC_VITAL_SIGNS_COLLECTION)
    .findOne({}, { projection: { turn: 1 }, sort: { turn: -1 } });
  if (vitalSigns && typeof vitalSigns.turn === "number") return vitalSigns.turn;
  const network = await db
    .collection<{ turn: number }>("sourcingNetworkLoad")
    .findOne({}, { projection: { turn: 1 }, sort: { turn: -1 } });
  return network && typeof network.turn === "number" ? network.turn : null;
}

// GET /api/admin/economy/market-access - Delivered-price and route visibility
// for the latest (or requested) turn: per-commodity landed premium / delivered
// price, the intra-state / interstate / import delivery mix, the top
// origin->destination routes by delivered units, and the resident-vs-local-
// producer demand split (#968, #991). Reads the persisted sourcing and
// market-formation inputs the snapshot phase writes; recomputes nothing else.
// Auth: requireAdmin
// Errors: 400, 403, 404
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = querySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries())
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const db = await getDb();
    const turn = parsed.data.turn ?? (await resolveLatestTurn(db));
    if (turn == null) {
      return NextResponse.json({ error: "No economic snapshot available" }, { status: 404 });
    }

    const [network, commodityDocs, vitalSigns, prices] = await Promise.all([
      db.collection<SourcingNetworkDoc>("sourcingNetworkLoad").findOne({ turn }),
      db.collection<CommoditySourcingDoc>("commoditySourcingFlows").find({ turn }).toArray(),
      db.collection<EconomicVitalSigns>(ECONOMIC_VITAL_SIGNS_COLLECTION).findOne({ turn }),
      db
        .collection<CommodityPrice>("commodityPrices")
        .find({}, { projection: { commodity: 1, globalPrice: 1, basePrice: 1 } })
        .toArray(),
    ]);

    if (!network && !vitalSigns) {
      return NextResponse.json(
        { error: `Market-access inputs not found for turn ${turn}` },
        { status: 404 }
      );
    }

    const globalPrices: Partial<Record<CommodityType, number>> = {};
    const basePrices: Partial<Record<CommodityType, number>> = {};
    for (const price of prices) {
      if (typeof price.globalPrice === "number") globalPrices[price.commodity] = price.globalPrice;
      if (typeof price.basePrice === "number") basePrices[price.commodity] = price.basePrice;
    }

    const marketAccess = computeMarketAccessVisibility({
      globalPrices,
      basePrices,
      network,
      commodityDocs,
      marketFormation: normalizeMarketFormationSnapshot(vitalSigns?.marketFormation),
    });

    return NextResponse.json({ turn, marketAccess });
  } catch (error) {
    return handleRouteError(error);
  }
}
