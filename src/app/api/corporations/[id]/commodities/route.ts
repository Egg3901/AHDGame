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
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import {
  fxRateForSectorHostFromMap,
  resolveSectorHostCurrencyCode,
} from "@/lib/currency/corporationCapital";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporateSector, ExchangeRate, State } from "@/lib/db/types";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import type { CommodityFlow } from "@/lib/db/types/commodityFlow";
import type { CommodityType } from "@/lib/constants/commodities";
import type { GameState } from "@/lib/db/types/gameState";
import type { SupplyAgreement } from "@/lib/db/types/supplyAgreement";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** Sector fields the flow derivation reads. Mirrors the world supply ledger. */
type CommoditySector = Pick<
  CorporateSector,
  | "_id"
  | "sectorType"
  | "stateId"
  | "countryId"
  | "revenue"
  | "strategyId"
  | "transitionFromStrategyId"
  | "transitionStartTurn"
  | "producedUnits"
  | "capitalStock"
  | "mothballed"
  | "productionPolicyLevel"
  | "embargoSuspended"
  | "embargoExportExposure"
  | "militaryDivertedFraction"
>;

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
    const canViewPrivateSupply =
      authUser?.isAdmin === true ||
      modViewEnabled ||
      (!!authUser?.userId && corporation.userId?.toString() === authUser.userId);
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
            "Cache-Control": "private, no-store",
          },
        }
      );
    }

    const mode = await getMarketSystemMode();
    const market = buildMarketContext(mode);

    const sectors = await db
      .collection<CorporateSector>("corporateSectors")
      .find({ corporationId: corporation._id })
      .project<CommoditySector>({
        sectorType: 1,
        stateId: 1,
        countryId: 1,
        revenue: 1,
        strategyId: 1,
        transitionFromStrategyId: 1,
        transitionStartTurn: 1,
        // Plants tier: measured production is what actually reaches the market,
        // and the nameplate legs below need the policy/embargo/diversion chain.
        producedUnits: 1,
        capitalStock: 1,
        mothballed: 1,
        productionPolicyLevel: 1,
        embargoSuspended: 1,
        embargoExportExposure: 1,
        militaryDivertedFraction: 1,
        _id: 1,
      })
      .toArray();

    const stateIds = [...new Set(sectors.map((s) => s.stateId))];

    const [
      gameState,
      states,
      latestFlows,
      marketShare,
      gameConfig,
      exchangeRateDocs,
      stateResourceCapacityDocs,
      eraUnitScale,
      supplyAgreements,
    ] = await Promise.all([
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
      db
        .collection<ExchangeRate>("exchangeRates")
        .find({}, { projection: { currencyCode: 1, rate: 1 } })
        .toArray(),
      db
        .collection<StateResourceCapacity>("stateResourceCapacity")
        .find({ stateId: { $in: stateIds } }, { projection: { stateId: 1, resources: 1 } })
        .toArray(),
      loadWorldEraUnitScale(db),
      canViewPrivateSupply
        ? db
            .collection<SupplyAgreement>("supplyAgreements")
            .find({
              buyerCorpId: corporation._id,
              status: { $in: ["active", "cancelling"] },
            })
            .project<
              Pick<
                SupplyAgreement,
                "commodity" | "volumeCap" | "lastDeliveryTurn" | "lastDeliveredUnits"
              >
            >({
              commodity: 1,
              volumeCap: 1,
              lastDeliveryTurn: 1,
              lastDeliveredUnits: 1,
            })
            .toArray()
        : Promise.resolve([]),
    ]);

    const currentTurn = gameState?.currentTurn ?? 0;
    const stateInfoById = new Map(
      states.map((s) => [s._id, { name: s.name, region: s.region ?? null }])
    );
    const latestFlowByCommodity = new Map<CommodityType, CommodityFlow>(
      latestFlows.map((f) => [f.commodity, f])
    );
    const privateSupplyRollup = new Map<
      CommodityType,
      { contractedUnits: number; deliveredUnits: number; latestTurn: number | null }
    >();
    if (gameConfig?.supplyAgreementsEnabled === true) {
      for (const agreement of supplyAgreements) {
        const existing = privateSupplyRollup.get(agreement.commodity) ?? {
          contractedUnits: 0,
          deliveredUnits: 0,
          latestTurn: null,
        };
        existing.contractedUnits += Math.max(0, agreement.volumeCap);
        const deliveryTurn = agreement.lastDeliveryTurn;
        if (Number.isFinite(deliveryTurn)) {
          if (existing.latestTurn === null || deliveryTurn! > existing.latestTurn) {
            existing.latestTurn = deliveryTurn!;
            existing.deliveredUnits = Math.max(0, agreement.lastDeliveredUnits ?? 0);
          } else if (deliveryTurn === existing.latestTurn) {
            existing.deliveredUnits += Math.max(0, agreement.lastDeliveredUnits ?? 0);
          }
        }
        privateSupplyRollup.set(agreement.commodity, existing);
      }
    }
    const privateSupplyByCommodity = new Map<
      CommodityType,
      { contractedUnits: number; deliveredUnits: number; turn: number }
    >();
    for (const [commodity, rollup] of privateSupplyRollup) {
      if (rollup.latestTurn === null) continue;
      privateSupplyByCommodity.set(commodity, {
        contractedUnits: rollup.contractedUnits,
        deliveredUnits: rollup.deliveredUnits,
        turn: rollup.latestTurn,
      });
    }

    // Revenue is booked in each sector's HOST currency; every nameplate leg in
    // the derivation runs in ₳, the basis COMMODITY_BASE_PRICES use. Normalize
    // here the way the world supply ledger does (commodityPriceTurn) — without
    // it a franc-denominated sector reports its FX rate as output (#1177).
    const fxByCurrency = new Map<CurrencyCode, number>(
      exchangeRateDocs.map((r) => [r.currencyCode as CurrencyCode, r.rate])
    );
    const flowSectors = sectors.map((sector) => ({
      ...sector,
      revenueAnchor: readCorpEconomicAnchor(
        sector.revenue,
        resolveSectorHostCurrencyCode(sector, corporation),
        fxRateForSectorHostFromMap(sector, corporation, fxByCurrency)
      ),
      capacityUnits: sector.capitalStock ?? null,
    }));
    const stateResourcesByState = new Map(
      stateResourceCapacityDocs.map((doc) => [doc.stateId, doc.resources])
    );

    const { commodities, regions } = computeCorpCommodityFlows(
      flowSectors,
      currentTurn,
      latestFlowByCommodity,
      stateInfoById,
      privateSupplyByCommodity,
      {
        plantsEnabled: marketAtLeast(mode, "plants"),
        isNatcorp: !!corporation.countryOwnerId,
        eraUnitScale,
        stateResourcesByState,
      }
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
          "Cache-Control": "private, no-store",
        },
      }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
