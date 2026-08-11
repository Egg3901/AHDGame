// GET /api/admin/commodities/regional?countryId=US&stateId=US-CA
// Returns per-commodity state-level prices, supply, demand for one state.
// Auth: requireAdmin
// Errors: 401, 403, 400

import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { handleRouteError } from "@/lib/api/errors";
import { countryIdSchema } from "@/lib/api/schemas/country";
import type { CommodityPrice, CommodityPriceHistory, GameState, State } from "@/lib/db/types";
import { computeCommodityPressureRatio } from "@/lib/constants/commodities";

const querySchema = z.object({
  countryId: countryIdSchema,
  stateId: z.string().min(1).optional(),
});

export const GET = withAdminAuth(async (_auth, request: Request) => {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      countryId: searchParams.get("countryId"),
      stateId: searchParams.get("stateId") || undefined,
    });
    if (!parsed.success) return NextResponse.json({ error: "Invalid countryId" }, { status: 400 });

    const { countryId, stateId } = parsed.data;
    const db = await getDb();

    const [prices, gameState] = await Promise.all([
      db.collection<CommodityPrice>("commodityPrices").find({}).toArray(),
      db
        .collection<GameState>("gameState")
        .findOne({ _id: "current" }, { projection: { currentTurn: 1 } }),
    ]);

    const currentTurn = gameState?.currentTurn ?? 0;
    const historyTurns = Math.min(
      Math.max(parseInt(searchParams.get("historyTurns") ?? "48", 10) || 48, 2),
      240
    );

    const historyDocs = await db
      .collection<CommodityPriceHistory>("commodityPriceHistory")
      .find({ turn: { $gte: currentTurn - historyTurns, $lte: currentTurn } })
      .sort({ turn: 1 })
      .toArray();

    // ── Single state view ──
    if (stateId) {
      const historyMap = new Map<string, { turn: number; price: number }[]>();
      for (const h of historyDocs) {
        if (!historyMap.has(h.commodity)) historyMap.set(h.commodity, []);
        const price = h.statePrices?.[stateId] ?? h.globalPrice;
        historyMap.get(h.commodity)!.push({ turn: h.turn, price });
      }

      const rows = prices.map((p) => {
        const price = p.statePrices?.[stateId] ?? p.globalPrice;
        const supply = p.stateSupply?.[stateId] ?? 0;
        const demand = p.stateDemand?.[stateId] ?? 0;
        const dsRatio = computeCommodityPressureRatio(supply, demand);
        const hardPegged = p.stateHardPegs?.[stateId] != null;
        const globalPegged = p.hardPeg != null;
        const nudged = p.stateNudges?.[stateId] != null;
        const changeFromGlobal =
          p.globalPrice > 0 ? ((price - p.globalPrice) / p.globalPrice) * 100 : 0;

        return {
          commodity: p.commodity,
          price,
          globalPrice: p.globalPrice,
          changeFromGlobal,
          supply,
          demand,
          dsRatio,
          hardPegged,
          globalPegged,
          nudged,
          pegPrice: p.stateHardPegs?.[stateId] ?? null,
          globalPegPrice: p.hardPeg ?? null,
          history: historyMap.get(p.commodity) ?? [],
        };
      });

      return NextResponse.json({ commodities: rows, stateId, mode: "state" });
    }

    // ── Country aggregate view ──
    // Get all stateIds belonging to this country
    const countryStates = await db
      .collection<State>("states")
      .find({ countryId }, { projection: { _id: 1 } })
      .toArray();
    const stateIds = new Set(countryStates.map((s) => s._id));

    // Build history using average state price across the country
    const historyMap = new Map<string, { turn: number; price: number }[]>();
    for (const h of historyDocs) {
      if (!historyMap.has(h.commodity)) historyMap.set(h.commodity, []);
      let sum = 0;
      let count = 0;
      if (h.statePrices) {
        for (const [sid, p] of Object.entries(h.statePrices)) {
          if (stateIds.has(sid)) {
            sum += p;
            count++;
          }
        }
      }
      const avgPrice = count > 0 ? sum / count : h.globalPrice;
      historyMap.get(h.commodity)!.push({ turn: h.turn, price: avgPrice });
    }

    const rows = prices.map((p) => {
      // Average price, sum supply/demand across all states in the country
      let priceSum = 0;
      let priceCount = 0;
      let totalSupply = 0;
      let totalDemand = 0;
      let statePegCount = 0;

      for (const sid of stateIds) {
        if (p.statePrices?.[sid] != null) {
          priceSum += p.statePrices[sid];
          priceCount++;
        }
        totalSupply += p.stateSupply?.[sid] ?? 0;
        totalDemand += p.stateDemand?.[sid] ?? 0;
        if (p.stateHardPegs?.[sid] != null) statePegCount++;
      }

      const avgPrice = priceCount > 0 ? priceSum / priceCount : p.globalPrice;
      const dsRatio = computeCommodityPressureRatio(totalSupply, totalDemand);
      const changeFromGlobal =
        p.globalPrice > 0 ? ((avgPrice - p.globalPrice) / p.globalPrice) * 100 : 0;

      return {
        commodity: p.commodity,
        price: Math.round(avgPrice * 100) / 100,
        globalPrice: p.globalPrice,
        changeFromGlobal,
        supply: Math.round(totalSupply * 100) / 100,
        demand: Math.round(totalDemand * 100) / 100,
        dsRatio,
        hardPegged: false,
        globalPegged: p.hardPeg != null,
        nudged: false,
        pegPrice: null,
        globalPegPrice: p.hardPeg ?? null,
        statePegCount,
        history: historyMap.get(p.commodity) ?? [],
      };
    });

    return NextResponse.json({
      commodities: rows,
      countryId,
      stateCount: stateIds.size,
      mode: "country",
    });
  } catch (error) {
    return handleRouteError(error);
  }
});
