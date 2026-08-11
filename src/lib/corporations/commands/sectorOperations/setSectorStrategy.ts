import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import type { CorporateSector, GameState } from "@/lib/db/types";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import type { CorporationType } from "@/lib/constants/corporations";
import {
  SECTOR_STRATEGIES,
  STRATEGY_RETOOL_COST_FRACTION,
  STRATEGY_TRANSITION_TURNS,
  STRATEGY_COOLDOWN_TURNS,
} from "@/lib/constants/sectorStrategies";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { setSectorStrategySchema as setStrategySchema } from "@/lib/api/schemas/corporations";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
  getSectorHostFxRate,
  resolveCorpLiquidCurrencyCode,
  resolveSectorHostCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { distributeConversionSpread } from "@/lib/currency/marketMaker";
import {
  COUNTRY_CURRENCY_MAP,
  SECTOR_FX_SPREAD,
  type CurrencyCode,
} from "@/lib/constants/currencies";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { insufficientCapitalMessage } from "@/lib/currency/insufficientCapitalMessage";
import { isExtractionStrategyZeroYield } from "@/lib/corporations/extractionStrategyAvailability";
import {
  shortageRetoolDecision,
  SHORTAGE_RETOOL_TRANSITION_HEADSTART,
} from "@/lib/corporations/shortageRetool";
import type { CommodityPrice } from "@/lib/db/types";
import type { CommodityType } from "@/lib/constants/commodities";
import { getStrategyAvailability } from "@/lib/constants/techTree";
import {
  capacityRescaleRatio,
  rescaleBuildQueueForStrategyChange,
} from "@/lib/constants/capacityEconomy";
import type { SectorBuildOrder } from "@/lib/db/types";
import { rescaleOtherOpexAnchorForRetool } from "@/lib/corporations/physicalPnl";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

/**
 * POST /api/corporations/[id]/sectors/[sectorId]/strategy
 * Change operating strategy for a sector. CEO only.
 * Charges 25% of daily revenue and begins a 12-turn transition.
 */
export async function setSectorStrategy(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id, sectorId } = await params;
    const parsed = await parseJsonBody(request, setStrategySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { strategyId } = parsed.data;
    const db = await getDb();

    // Resolve corporation + CEO check
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    // Resolve sector
    if (!ObjectId.isValid(sectorId)) {
      return NextResponse.json({ error: "Invalid sector ID" }, { status: 400 });
    }

    const sector = await db
      .collection<CorporateSector>("corporateSectors")
      .findOne({ _id: new ObjectId(sectorId), corporationId: corporation._id });

    if (!sector) {
      return NextResponse.json({ error: "Sector not found" }, { status: 404 });
    }

    // Validate strategy exists for this sector type
    const sectorType = sector.sectorType as CorporationType;
    const strategies = SECTOR_STRATEGIES[sectorType];
    if (!strategies) {
      return NextResponse.json(
        { error: "No strategies available for this sector type" },
        { status: 400 }
      );
    }

    const targetStrategy = strategies.find((s) => s.id === strategyId);
    if (!targetStrategy) {
      return NextResponse.json({ error: "Invalid strategy for this sector type" }, { status: 400 });
    }

    // Check not already on this strategy
    const currentStrategyId = sector.strategyId ?? "standard";
    if (currentStrategyId === strategyId && !sector.transitionFromStrategyId) {
      return NextResponse.json({ error: "Already using this strategy" }, { status: 400 });
    }

    // Check not currently transitioning
    if (sector.transitionFromStrategyId) {
      return NextResponse.json(
        { error: "Already transitioning to a new strategy. Wait for completion." },
        { status: 400 }
      );
    }

    // Get current turn
    const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const currentTurn = gameState?.currentTurn ?? 0;

    // Tech-tree production-method gate: modern methods are locked until the
    // world reaches their era and/or the corp unlocks them in the tech tree.
    // Inert when the feature is off.
    const techTreesEnabled = gameState?.sectorTechTreesEnabled === true;
    const currentYear =
      gameState?.currentYear ??
      STARTING_YEAR + Math.floor((Math.max(1, currentTurn) - 1) / TURNS_PER_YEAR);
    const availability = getStrategyAvailability(
      {
        type: corporation.type,
        unlockedTechNodeIds: corporation.unlockedTechNodeIds,
        techDecadeLane: corporation.techDecadeLane,
      },
      targetStrategy,
      currentYear,
      techTreesEnabled
    );
    if (availability.locked) {
      return NextResponse.json(
        {
          error:
            availability.reason === "era"
              ? "This production method is not available in this era yet."
              : "Unlock this production method in the Tech tree first.",
        },
        { status: 400 }
      );
    }

    // Check cooldown
    if (
      sector.transitionCooldownUntilTurn != null &&
      currentTurn < sector.transitionCooldownUntilTurn
    ) {
      const remaining = sector.transitionCooldownUntilTurn - currentTurn;
      return NextResponse.json(
        { error: `Strategy change on cooldown. ${remaining} turns remaining.` },
        { status: 400 }
      );
    }

    if (sectorType === "extraction") {
      const capDoc = await db
        .collection<StateResourceCapacity>("stateResourceCapacity")
        .findOne({ stateId: sector.stateId }, { projection: { resources: 1 } });
      const stateResources = capDoc ? (capDoc.resources ?? null) : undefined;

      if (isExtractionStrategyZeroYield(targetStrategy, stateResources)) {
        return NextResponse.json(
          {
            error: "Selected extraction strategy has no matching resource deposits in this state.",
          },
          { status: 400 }
        );
      }
    }

    // Shortage-destination discount: switching INTO a strategy that supplies a
    // resource in global shortage (s/d < 0.5) waives the retool fee and halves
    // the transition window. Lagged balances from commodityPrices — same
    // one-turn lag as every market input. Self-deactivates as supply recovers.
    const priceBalanceDocs = await db
      .collection<CommodityPrice>("commodityPrices")
      .find({}, { projection: { commodity: 1, globalSupply: 1, globalDemand: 1 } })
      .toArray();
    const globalBalances = new Map<CommodityType, { supply: number; demand: number }>(
      priceBalanceDocs.map((d) => [
        d.commodity,
        { supply: d.globalSupply ?? 0, demand: d.globalDemand ?? 0 },
      ])
    );
    const shortageDiscount = shortageRetoolDecision(targetStrategy, globalBalances);

    // Charge retooling cost (25% of daily revenue).
    // sector.revenue is stored in the sector's HOST-state currency; normalize to
    // ₳ at the host rate. corpFxRate/liquidCode below re-denominate the ₳ cost
    // back to the corp's currency for the liquidCapital $inc and drive the
    // foreign-sector spread.
    const corpFxRate = await getCorpFxRate(db, corporation);
    const liquidCode = resolveCorpLiquidCurrencyCode(corporation);
    const sectorHostRate = await getSectorHostFxRate(db, sector, corporation);
    const retoolCostAnchor = shortageDiscount.qualifies
      ? 0
      : readCorpEconomicAnchor(
          sector.revenue,
          resolveSectorHostCurrencyCode(sector, corporation),
          sectorHostRate
        ) * STRATEGY_RETOOL_COST_FRACTION;
    // Foreign-sector FX friction (symmetry with the foreign operating-income
    // spread): retooling a sector in a different-currency country incurs the
    // reduced sector spread on top of the base cost, routed to the CB system.
    const corpCcy = (liquidCode ?? null) as CurrencyCode | null;
    const sectorCcy = (COUNTRY_CURRENCY_MAP[
      sector.countryId as keyof typeof COUNTRY_CURRENCY_MAP
    ] ?? null) as CurrencyCode | null;
    const isForeignSector = !!corpCcy && !!sectorCcy && corpCcy !== sectorCcy;
    const foreignSpreadAnchor = isForeignSector ? retoolCostAnchor * SECTOR_FX_SPREAD : 0;
    const totalCostAnchor = retoolCostAnchor + foreignSpreadAnchor;
    const corpCapitalAnchor = corpLiquidCapitalToAnchor(
      corporation.liquidCapital,
      corporation,
      corpFxRate
    );
    if (corpCapitalAnchor < totalCostAnchor) {
      return NextResponse.json(
        {
          error:
            insufficientCapitalMessage(
              "Retooling",
              anchorToCorpLiquidCapital(totalCostAnchor, corporation, corpFxRate),
              corporation.liquidCapital,
              resolveCorpLiquidCurrencyCode(corporation)
            ) + " (25% of daily revenue, incl. FX on foreign sector).",
        },
        { status: 400 }
      );
    }

    const retoolCostInCorpCapital = anchorToCorpLiquidCapital(
      totalCostAnchor,
      corporation,
      corpFxRate
    );

    // ─── D9: RPU normalization at the retool boundary ────────────────────────
    // `capitalStock` counts output units/day, and those units are NOT
    // commensurable across production methods — the same physical plant is worth
    // 1/Σ(rate/basePrice) ₳ of output per unit, which differs by orders of
    // magnitude between (say) a coal mix and a rare-earth mix. Left alone, a
    // retool would silently re-price the plant by that ratio: capacity nobody
    // built, granted by a retool fee. Re-scale the stock so the NAMEPLATE
    // (capacity × mixPrice) is invariant across the change. Build orders in
    // flight move by the same ratio (their paid cash does not — see
    // `rescaleBuildQueueForStrategyChange`).
    // PLANTS-GATED. Under CAPITAL mode the sector turn already writes a non-zero
    // `capitalStock` and gates production off it, so rescaling there would move
    // live production by the mix ratio — orders of magnitude for some strategy
    // pairs. The RPU basis this normalizes is a plants-tier concept, so only
    // plants worlds rescale; below it the stock keeps its existing meaning.
    // Rescaled ONCE, here, against the FINAL rates — the 12-turn blend window
    // misprices slightly and decays to exact; see the function's docs.
    const marketMode = await getMarketSystemModeForDb(db);
    const plantsEnabled = marketAtLeast(marketMode, "plants");
    const rescaleRatio = capacityRescaleRatio(sectorType, currentStrategyId, strategyId);
    const rescaledCapitalStock =
      plantsEnabled &&
      typeof sector.capitalStock === "number" &&
      Number.isFinite(sector.capitalStock)
        ? sector.capitalStock * rescaleRatio
        : null;
    const rescaledBuildQueue: SectorBuildOrder[] | null =
      plantsEnabled && Array.isArray(sector.buildQueue) && sector.buildQueue.length > 0
        ? rescaleBuildQueueForStrategyChange(sector.buildQueue, rescaleRatio)
        : null;
    // P3.5: the calibrated other-opex residual is ₳ per OUTPUT UNIT, and this
    // retool changes what a unit is. Move it by the inverse ratio so the ₳ it
    // actually charges is invariant across the retool — same rule, same gate and
    // same invertibility as `capitalStock` above.
    const rescaledOtherOpexAnchor = plantsEnabled
      ? rescaleOtherOpexAnchorForRetool(sector.otherOpexPerUnitAnchor, rescaleRatio)
      : null;

    // Apply changes atomically
    await Promise.all([
      // Deduct retooling cost from corporation
      db
        .collection("corporations")
        .updateOne(
          { _id: corporation._id },
          { $inc: { liquidCapital: -retoolCostInCorpCapital }, $set: { updatedAt: new Date() } }
        ),
      // Start transition on sector
      db.collection<CorporateSector>("corporateSectors").updateOne(
        { _id: sector._id },
        {
          $set: {
            strategyId,
            transitionFromStrategyId: currentStrategyId,
            // Shortage destinations get a half-window transition: backdating
            // the start turn makes every consumer of the standard progress
            // formula see the shorter ramp without schema changes.
            transitionStartTurn: shortageDiscount.qualifies
              ? currentTurn - SHORTAGE_RETOOL_TRANSITION_HEADSTART
              : currentTurn,
            transitionCooldownUntilTurn: currentTurn + STRATEGY_COOLDOWN_TURNS,
            // Persist whether the forward rescale actually ran, so a cancel can
            // decide whether to invert it. `plantsEnabled` is resolved
            // independently by each command at ITS call time: a retool committed
            // under capital mode and cancelled after a flip to plants would
            // otherwise apply the inverse ratio to a stock nothing ever scaled,
            // minting or burning the full RPU ratio (up to 327x). The flag, not
            // the mode, is the authority on the cancel side.
            // Records the GATE, not whether a particular leg found something to
            // scale: an empty build queue or an absent `capitalStock` is still a
            // retool that happened under the plants rule, and a later cancel of
            // it must invert on the same rule.
            retoolRescaleApplied: plantsEnabled,
            ...(rescaledCapitalStock != null ? { capitalStock: rescaledCapitalStock } : {}),
            ...(rescaledBuildQueue != null ? { buildQueue: rescaledBuildQueue } : {}),
            ...(rescaledOtherOpexAnchor != null
              ? { otherOpexPerUnitAnchor: rescaledOtherOpexAnchor }
              : {}),
            updatedAt: new Date(),
          },
        }
      ),
    ]);

    // Route the foreign-sector FX spread (already added to the debit) to the CB
    // system — reserve → the sector-country CB; revenue → the corp's CB.
    if (foreignSpreadAnchor > 0 && corpCcy && sectorCcy) {
      const feeInCorp = Math.round(
        anchorToCorpLiquidCapital(foreignSpreadAnchor, corporation, corpFxRate)
      );
      await distributeConversionSpread(db, feeInCorp, corpCcy, sectorCcy);
    }

    return NextResponse.json({
      success: true,
      strategyId,
      strategyName: targetStrategy.name,
      // retoolCost is returned in ₳ so the client can format via
      // formatAmount(retoolCost, corp.liquidCurrencyCode).
      retoolCost: Math.round(retoolCostAnchor),
      spreadPaid: Math.round(foreignSpreadAnchor),
      transitionTurns: shortageDiscount.qualifies
        ? STRATEGY_TRANSITION_TURNS - SHORTAGE_RETOOL_TRANSITION_HEADSTART
        : STRATEGY_TRANSITION_TURNS,
      cooldownTurns: STRATEGY_COOLDOWN_TURNS,
      // Shortage-destination discount metadata (client toast/messaging).
      shortageDiscount: shortageDiscount.qualifies
        ? { resource: shortageDiscount.resource, sd: shortageDiscount.sd }
        : null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
