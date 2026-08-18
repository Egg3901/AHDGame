// GET /api/admin/commodities
// Returns the most recent price document per commodity with nudge state and D/S ratios.
// Auth: requireAdmin
// Errors: 403

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { handleRouteError } from "@/lib/api/errors";
import type { CommodityPrice, CommodityPriceHistory, GameState } from "@/lib/db/types";
import { computeCommodityPressureRatio } from "@/lib/constants/commodities";

export const GET = withAdminAuth(async (_auth, request: Request) => {
  try {
    const { searchParams } = new URL(request.url);
    const historyTurns = Math.min(
      Math.max(parseInt(searchParams.get("historyTurns") ?? "48", 10) || 48, 2),
      240
    );

    const db = await getDb();
    const [prices, gameState] = await Promise.all([
      db.collection<CommodityPrice>("commodityPrices").find({}).toArray(),
      db
        .collection<GameState>("gameState")
        .findOne({ _id: "current" }, { projection: { currentTurn: 1 } }),
    ]);

    const currentTurn = gameState?.currentTurn ?? 0;
    const minTurn = currentTurn - historyTurns;

    // Fetch price history for sparklines
    const historyDocs = await db
      .collection<CommodityPriceHistory>("commodityPriceHistory")
      .find({ turn: { $gte: minTurn, $lte: currentTurn } })
      .sort({ turn: 1 })
      .toArray();

    // Group history by commodity
    const historyMap = new Map<string, { turn: number; price: number }[]>();
    for (const h of historyDocs) {
      const key = h.commodity;
      if (!historyMap.has(key)) historyMap.set(key, []);
      historyMap.get(key)!.push({ turn: h.turn, price: h.globalPrice });
    }

    const rows = prices.map((p) => {
      const dsRatio = computeCommodityPressureRatio(p.globalSupply, p.globalDemand);
      const priceChangePct =
        p.basePrice > 0 ? ((p.globalPrice - p.basePrice) / p.basePrice) * 100 : 0;
      const nudgeActive = p.nudgePrice != null && p.nudgeTurn === currentTurn;
      const statePegCount = p.stateHardPegs ? Object.keys(p.stateHardPegs).length : 0;
      const stateNudgeCount = p.stateNudges ? Object.keys(p.stateNudges).length : 0;
      return {
        commodity: p.commodity,
        globalPrice: p.globalPrice,
        basePrice: p.basePrice,
        priceChangePct,
        globalSupply: p.globalSupply,
        globalDemand: p.globalDemand,
        dsRatio,
        nudgeActive,
        nudgePrice: p.nudgePrice ?? null,
        hardPeg: p.hardPeg ?? null,
        statePegCount,
        stateNudgeCount,
        history: historyMap.get(p.commodity) ?? [],
      };
    });

    const shortage = rows.filter((r) => r.dsRatio >= 1.1);
    const worstShortage = [...shortage].sort((a, b) => b.dsRatio - a.dsRatio)[0] ?? null;
    const globalPegCount = rows.filter((r) => r.hardPeg != null).length;
    const totalStatePegs = rows.reduce((sum, r) => sum + r.statePegCount, 0);

    return NextResponse.json({
      summary: {
        shortageCount: shortage.length,
        balancedCount: rows.filter((r) => r.dsRatio < 1.1 && r.dsRatio > 0.9).length,
        surplusCount: rows.filter((r) => r.dsRatio <= 0.9).length,
        worstShortage: worstShortage
          ? { commodity: worstShortage.commodity, dsRatio: worstShortage.dsRatio }
          : null,
        nudgeCount: rows.filter((r) => r.nudgeActive).length,
        globalPegCount,
        totalStatePegs,
      },
      commodities: rows,
      currentTurn,
    });
  } catch (error) {
    return handleRouteError(error);
  }
});
