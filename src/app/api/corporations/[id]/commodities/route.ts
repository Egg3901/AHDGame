import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { getAuthUser } from "@/lib/auth";
import { shouldRedactCorporation } from "@/lib/corporations/redaction";
import { computeCorpCommodityFlows } from "@/lib/corporations/corpCommodityFlows";
import { computeCorpMarketShare } from "@/lib/corporations/corpMarketShare";
import { getMarketSystemMode, marketAtLeast } from "@/lib/market/featureFlag";
import { buildMarketContext } from "@/lib/market/marketContext";
import type { CorporateSector, State } from "@/lib/db/types";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import type { CommodityFlow } from "@/lib/db/types/commodityFlow";
import type { CommodityType } from "@/lib/constants/commodities";
import type { GameState } from "@/lib/db/types/gameState";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/corporations/[id]/commodities — Per-turn commodity output/consumption,
// regional breakdown, and by-industry market share for a corporation.
// Auth: public (financials of private corps are redacted from non-CEO viewers).
// Errors: 400, 404
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    // Fog of war: private corps disclose no flows/share to non-CEO viewers.
    const authUser = await getAuthUser().catch(() => null);
    const modViewEnabled =
      !authUser?.isAdmin &&
      authUser?.isModerator === true &&
      new URL(request.url).searchParams.get("modView") === "1";
    if (
      shouldRedactCorporation(
        corporation,
        authUser?.userId,
        authUser?.isAdmin === true,
        modViewEnabled
      )
    ) {
      return NextResponse.json(
        { isPrivate: true, clearingEnabled: false, commodities: [], regions: [], marketShare: [] },
        {
          headers: {
            "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300, no-transform",
          },
        }
      );
    }

    const mode = await getMarketSystemMode();
    const market = buildMarketContext(mode);

    const sectors = await db
      .collection<CorporateSector>("corporateSectors")
      .find({ corporationId: corporation._id })
      .project<
        Pick<
          CorporateSector,
          | "_id"
          | "sectorType"
          | "stateId"
          | "revenue"
          | "strategyId"
          | "transitionFromStrategyId"
          | "transitionStartTurn"
        >
      >({
        sectorType: 1,
        stateId: 1,
        revenue: 1,
        strategyId: 1,
        transitionFromStrategyId: 1,
        transitionStartTurn: 1,
        _id: 1,
      })
      .toArray();

    if (sectors.length === 0) {
      return NextResponse.json(
        {
          clearingEnabled: market.clearingEnabled,
          commodities: [],
          regions: [],
          marketShare: [],
        },
        {
          headers: {
            "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300, no-transform",
          },
        }
      );
    }

    const stateIds = [...new Set(sectors.map((s) => s.stateId))];

    const [gameState, states, latestFlows, marketShare, gameConfig] = await Promise.all([
      db
        .collection<GameState>("gameState")
        .findOne({ _id: "current" }, { projection: { currentTurn: 1 } }),
      db
        .collection<State>("states")
        .find({ _id: { $in: stateIds } })
        .project<{ _id: string; name: string; region: string }>({ _id: 1, name: 1, region: 1 })
        .toArray(),
      // Latest global flow ledger row per commodity (market context).
      db
        .collection<CommodityFlow>("commodityFlows")
        .aggregate<CommodityFlow>([
          { $sort: { turn: -1 } },
          { $group: { _id: "$commodity", doc: { $first: "$$ROOT" } } },
          { $replaceRoot: { newRoot: "$doc" } },
        ])
        .toArray(),
      computeCorpMarketShare(db, corporation, sectors),
      db.collection<GameConfig>("gameConfig").findOne(
        { _id: "default" },
        {
          projection: {
            brandLoyaltyEnabled: 1,
            brandLoyaltySliceEnabled: 1,
            sectorQualityEnabled: 1,
            supplyAgreementsEnabled: 1,
            marketSystemMode: 1,
          },
        }
      ),
    ]);

    const currentTurn = gameState?.currentTurn ?? 0;
    const stateInfoById = new Map(
      states.map((s) => [s._id, { name: s.name, region: s.region ?? null }])
    );
    const latestFlowByCommodity = new Map<CommodityType, CommodityFlow>(
      latestFlows.map((f) => [f.commodity, f])
    );

    const { commodities, regions } = computeCorpCommodityFlows(
      sectors,
      currentTurn,
      latestFlowByCommodity,
      stateInfoById
    );

    return NextResponse.json(
      {
        clearingEnabled: market.clearingEnabled,
        ledgerEnabled: marketAtLeast(mode, "ledger"),
        brandLoyaltyEnabled: gameConfig?.brandLoyaltyEnabled === true,
        brandLoyaltySliceEnabled: gameConfig?.brandLoyaltySliceEnabled === true,
        sectorQualityEnabled: gameConfig?.sectorQualityEnabled === true,
        supplyAgreementsEnabled: gameConfig?.supplyAgreementsEnabled === true,
        commodities,
        regions,
        marketShare,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300, no-transform",
        },
      }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
