import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { CentralBank, Corporation, CorporateSector } from "@/lib/db/types";
import {
  calculateDailyGrowthCost,
  GROWTH_ADJUST_COST_PER_PERCENT,
  MAX_GROWTH_RATE,
  MIN_GROWTH_RATE,
  GROWTH_RATE_TURNS_PER_YEAR,
} from "@/lib/constants/corporations";
import { getCountryConfig } from "@/lib/constants/countries";
import { z } from "zod";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import { insufficientCapitalMessage } from "@/lib/currency/insufficientCapitalMessage";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { fetchSectorMarketSharePercent } from "@/lib/corporations/marketShare";
import { getBankId } from "@/lib/centralBank/helpers";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";

const adjustGrowthSchema = z.object({
  sectorId: z.string().min(1, "Sector ID is required"),
  direction: z.enum(["expand", "downsize"]),
});

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

// POST /api/country/[code]/region/[id]/economy/adjust-growth — Expand or downsize the growth rate of a corporate sector
// Auth: requireAuth
// Errors: 400, 401, 404, 429
/**
 * POST /api/country/[code]/region/[id]/economy/adjust-growth
 * Expand (+1% growth) or downsize (-1% growth) a sector.
 * Expand costs capital; downsize returns capital.
 * Cost per 1% = sector.revenue × GROWTH_ADJUST_COST_PER_PERCENT.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const stateId = id;

    const parsed = await parseJsonBody(request, adjustGrowthSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { sectorId, direction } = parsed.data;
    const db = await getDb();

    // Get player's character and corporation
    const character = auth.user.character;
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const corporation = await db
      .collection<Corporation>("corporations")
      .findOne({ ceoId: character._id, ceoVacant: { $ne: true } });
    if (!corporation) {
      return NextResponse.json({ error: "You don't own a corporation" }, { status: 400 });
    }

    // Find the sector
    if (!ObjectId.isValid(sectorId)) {
      return NextResponse.json({ error: "Invalid sector ID" }, { status: 400 });
    }

    const sector = await db.collection<CorporateSector>("corporateSectors").findOne({
      _id: new ObjectId(sectorId),
      corporationId: corporation._id,
      stateId,
    });
    if (!sector) {
      return NextResponse.json({ error: "Sector not found or not yours" }, { status: 404 });
    }

    // The growth slider is vestigial under plants: the corporation phase sets
    // `targetGrowthRate` and `currentGrowthCost` to 0 for every sector on every
    // plants turn (sectorTurn.ts, inside `if (plantsEnabled)`), because capacity
    // is what moves output there. Without this guard the player is charged
    // `sector.revenue x GROWTH_ADJUST_COST_PER_PERCENT` for a field the very
    // next turn resets — real money for nothing, repeatable. Human growth goes
    // through build orders instead. (The NPP brain still READS
    // targetGrowthRate, but it converts its own judgement into build orders in
    // the same phase; it never pays this charge.)
    if (marketAtLeast(await getMarketSystemModeForDb(db), "plants")) {
      return NextResponse.json(
        {
          error:
            "Growth is set by building capacity now, not by this slider. Open the sector and use Build Capacity.",
        },
        { status: 403 }
      );
    }

    // sector.revenue is stored in the corp's home (liquidCapital) currency
    // since v0.2.6, so the +1% cost and the corp's treasury are already the
    // same currency — compare and charge directly, no ₳ round-trip. (The old
    // anchor conversion divided the ¥ balance by the FX rate and compared it
    // against a yen-magnitude cost, falsely rejecting affordable expansions.)
    const adjustCost = sector.revenue * GROWTH_ADJUST_COST_PER_PERCENT;
    const corpCurrencyCode = resolveCorpLiquidCurrencyCode(corporation);
    let newGrowthRate: number;

    if (direction === "expand") {
      newGrowthRate = (sector.targetGrowthRate ?? 0) + 1;
      if (newGrowthRate > MAX_GROWTH_RATE) {
        return NextResponse.json(
          { error: `Growth rate cannot exceed ${MAX_GROWTH_RATE}%` },
          { status: 400 }
        );
      }
      if (corporation.liquidCapital < adjustCost) {
        return NextResponse.json(
          {
            error: insufficientCapitalMessage(
              "Expanding",
              adjustCost,
              corporation.liquidCapital,
              corpCurrencyCode
            ),
          },
          { status: 400 }
        );
      }
      // Deduct capital (corp's local currency)
      await db
        .collection<Corporation>("corporations")
        .updateOne(
          { _id: corporation._id },
          { $inc: { liquidCapital: -adjustCost }, $set: { updatedAt: new Date() } }
        );
    } else {
      newGrowthRate = (sector.targetGrowthRate ?? 0) - 1;
      if (newGrowthRate < MIN_GROWTH_RATE) {
        return NextResponse.json(
          { error: `Growth rate cannot go below ${MIN_GROWTH_RATE}%` },
          { status: 400 }
        );
      }
      // Return capital (corp's local currency)
      await db
        .collection<Corporation>("corporations")
        .updateOne(
          { _id: corporation._id },
          { $inc: { liquidCapital: adjustCost }, $set: { updatedAt: new Date() } }
        );
    }

    // Update sector growth rate and recalculate daily growth cost from per-turn growth basis.
    // Dominance multiplier matches the turn processor so the persisted
    // currentGrowthCost reflects the actual charge for next turn.
    const perTurnGrowthRate = newGrowthRate / GROWTH_RATE_TURNS_PER_YEAR;
    // getBankId: shared-bank members (IE → ECB) have no doc under their own id.
    const centralBank = await db
      .collection<CentralBank>("centralBanks")
      .findOne({ _id: getBankId(countryId) });
    const primeRate =
      centralBank?.primeRate ?? getCountryConfig(countryId).centralBank.defaultPrimeRate;
    const marketSharePct = await fetchSectorMarketSharePercent(db, sector, corporation);
    const newGrowthCost = calculateDailyGrowthCost(
      sector.revenue,
      perTurnGrowthRate,
      primeRate,
      marketSharePct
    );

    await db.collection<CorporateSector>("corporateSectors").updateOne(
      { _id: sector._id },
      {
        $set: {
          targetGrowthRate: newGrowthRate,
          currentGrowthCost: newGrowthCost,
          updatedAt: new Date(),
        },
      }
    );

    const verb = direction === "expand" ? "Expanded" : "Downsized";
    const capitalChange = direction === "expand" ? -adjustCost : adjustCost;
    const sym = (corpCurrencyCode && CURRENCY_SYMBOLS[corpCurrencyCode]) || "$";

    return NextResponse.json({
      success: true,
      direction,
      newGrowthRate,
      currentGrowthCost: Math.round(newGrowthCost),
      capitalChange: Math.round(capitalChange),
      message: `${verb} growth to ${newGrowthRate}% (${direction === "expand" ? "-" : "+"}${sym}${Math.round(adjustCost).toLocaleString()})`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
