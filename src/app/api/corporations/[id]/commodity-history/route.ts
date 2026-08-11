import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { getAuthUser } from "@/lib/auth";
import { shouldRedactCorporation } from "@/lib/corporations/redaction";
import { computeCommodityOutputSharePercent } from "@/lib/corporations/corpCommoditySnapshot";
import type { CorporationHistory } from "@/lib/db/types";
import type { CommodityFlow } from "@/lib/db/types/commodityFlow";
import type { CommodityType } from "@/lib/constants/commodities";
import { COMMODITY_ICONS, COMMODITY_LABELS, COMMODITY_UNITS } from "@/lib/constants/commodities";
import type { CommodityHistoryPoint, CommodityHistorySeries } from "@/lib/corporations/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Response contract types live in the domain layer so client components can
// import them without depending on this route module.
export type { CommodityHistoryPoint, CommodityHistorySeries };

// GET /api/corporations/[id]/commodity-history — Output share + global stockpile
// time series for commodities this corporation produces.
// Auth: public (private corps redacted for non-CEO viewers).
// Errors: 400, 404
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

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
        { isPrivate: true, series: [] },
        {
          headers: {
            "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300, no-transform",
          },
        }
      );
    }

    const MAX_CHART_POINTS = 500;

    const history = await db
      .collection<CorporationHistory>("corporationHistory")
      .aggregate<Pick<CorporationHistory, "turn" | "commodityOutput">>([
        { $match: { corporationId: corporation._id, commodityOutput: { $exists: true } } },
        { $sort: { turn: -1, createdAt: -1, _id: -1 } },
        { $group: { _id: "$turn", doc: { $first: "$$ROOT" } } },
        { $replaceRoot: { newRoot: "$doc" } },
        { $sort: { turn: 1 } },
        { $project: { _id: 0, turn: 1, commodityOutput: 1 } },
      ])
      .toArray();

    if (history.length === 0) {
      return NextResponse.json(
        { series: [] },
        {
          headers: {
            "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300, no-transform",
          },
        }
      );
    }

    const commoditySet = new Set<CommodityType>();
    for (const row of history) {
      if (!row.commodityOutput) continue;
      for (const key of Object.keys(row.commodityOutput)) {
        commoditySet.add(key as CommodityType);
      }
    }
    const commodities = [...commoditySet];
    if (commodities.length === 0) {
      return NextResponse.json(
        { series: [] },
        {
          headers: {
            "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300, no-transform",
          },
        }
      );
    }

    const minTurn = history[0].turn;
    const maxTurn = history[history.length - 1].turn;

    const flows = await db
      .collection<CommodityFlow>("commodityFlows")
      .find({
        commodity: { $in: commodities },
        turn: { $gte: minTurn, $lte: maxTurn },
      })
      .project<Pick<CommodityFlow, "commodity" | "turn" | "supplyUnits" | "stockUnits">>({
        commodity: 1,
        turn: 1,
        supplyUnits: 1,
        stockUnits: 1,
      })
      .toArray();

    const flowByCommodityTurn = new Map<
      string,
      Pick<CommodityFlow, "commodity" | "turn" | "supplyUnits" | "stockUnits">
    >();
    for (const f of flows) {
      flowByCommodityTurn.set(`${f.commodity}:${f.turn}`, f);
    }

    // Downsample to bounded chart points (same spirit as /history?full=1).
    let sampled = history;
    if (history.length > MAX_CHART_POINTS) {
      const stride = Math.ceil(history.length / MAX_CHART_POINTS);
      sampled = history.filter((row, i) => i % stride === 0 || i === history.length - 1);
    }

    const series: CommodityHistorySeries[] = commodities.map((commodity) => {
      const points: CommodityHistoryPoint[] = [];
      for (const row of sampled) {
        const outputUnits = row.commodityOutput?.[commodity] ?? 0;
        if (!(outputUnits > 0)) continue;
        const flow = flowByCommodityTurn.get(`${commodity}:${row.turn}`);
        const globalSupplyUnits = flow?.supplyUnits ?? null;
        const sharePercent =
          globalSupplyUnits != null
            ? computeCommodityOutputSharePercent(outputUnits, globalSupplyUnits)
            : null;
        points.push({
          turn: row.turn,
          outputUnits,
          globalSupplyUnits,
          sharePercent,
          stockUnits: flow?.stockUnits ?? null,
        });
      }
      return {
        commodity,
        label: COMMODITY_LABELS[commodity],
        icon: COMMODITY_ICONS[commodity],
        unit: COMMODITY_UNITS[commodity],
        points,
      };
    });

    series.sort((a, b) => {
      const aLast = a.points[a.points.length - 1]?.outputUnits ?? 0;
      const bLast = b.points[b.points.length - 1]?.outputUnits ?? 0;
      return bLast - aLast;
    });

    return NextResponse.json(
      { series: series.filter((s) => s.points.length > 0) },
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
