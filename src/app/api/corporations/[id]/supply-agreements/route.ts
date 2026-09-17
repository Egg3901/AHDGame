import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCeo, resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { proposeSupplyAgreement } from "@/lib/corporations/commands/supplyAgreements";
import {
  CONTRACT_OVERCOMMIT_TOLERANCE,
  type SupplyAgreementOffer,
  type SupplyAgreement,
} from "@/lib/db/types/supplyAgreement";
import type { CorporateSector } from "@/lib/db/types";
import type { GameState } from "@/lib/db/types/gameState";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import { COMMODITY_TYPES, type CommodityType } from "@/lib/constants/commodities";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import {
  computeSupplierCommodityAchievableUnits,
  computeSupplierCommodityCapacityUnits,
  supplyAgreementSectorStates,
} from "@/lib/corporations/supplyAgreementCapacity";
import { supportsCorporationWideSupplyAgreement } from "@/lib/market/commodityMarketScope";
import type { State } from "@/lib/db/types/state";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function legacyOffer(agreement: SupplyAgreement): SupplyAgreementOffer {
  return {
    revision: 1,
    proposedByCorpId: agreement.proposedByCorpId,
    volumeCap: agreement.volumeCap,
    pricePremium: agreement.pricePremium,
    exclusive: agreement.exclusive ?? false,
    ...(agreement.durationTurns !== undefined ? { durationTurns: agreement.durationTurns } : {}),
    proposedAt: agreement.createdAt ?? new Date(0),
  };
}

function serializeOffer(offer: SupplyAgreementOffer) {
  return {
    ...offer,
    proposedByCorpId: offer.proposedByCorpId.toString(),
  };
}

/** GET: list this corp's supply agreements (as supplier or buyer). */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const { id } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const ceoError = requireCeo(resolved.corporation, auth.user.userId);
    if (ceoError) return ceoError;
    const corp = resolved.corporation;
    const corpId = corp._id;
    const agreements = await db
      .collection<SupplyAgreement>("supplyAgreements")
      .find({ $or: [{ supplierCorpId: corpId }, { buyerCorpId: corpId }] })
      .sort({ updatedAt: -1 })
      .toArray();
    const counterpartyIds = [
      ...new Set(
        agreements.flatMap((agreement) => [
          agreement.supplierCorpId.toString(),
          agreement.buyerCorpId.toString(),
        ])
      ),
    ];
    const counterparties =
      counterpartyIds.length > 0
        ? await db
            .collection("corporations")
            .find({
              _id: { $in: counterpartyIds.map((counterpartyId) => new ObjectId(counterpartyId)) },
            })
            .project<{ _id: ObjectId; name: string; ticker?: string | null }>({
              name: 1,
              ticker: 1,
            })
            .toArray()
        : [];
    const counterpartyById = new Map(
      counterparties.map((counterparty) => [counterparty._id.toString(), counterparty])
    );
    type CapacitySnapshot = {
      currentCapacityUnits: number;
      maxContractUnits: number;
      achievableUnits: number | null;
    };
    const capacityByCommodity: Partial<Record<CommodityType, CapacitySnapshot>> = {};
    // State-scoped commodities (freight) are contracted per state, so their
    // capacity is reported per host state the supplier has plants in.
    const capacityByState: Partial<
      Record<CommodityType, Record<string, CapacitySnapshot & { stateName: string }>>
    > = {};
    if (marketAtLeast(await getMarketSystemModeForDb(db), "plants")) {
      const [sectors, world, config] = await Promise.all([
        db
          .collection<CorporateSector>("corporateSectors")
          .find(
            { corporationId: corp._id },
            {
              projection: {
                sectorType: 1,
                capitalStock: 1,
                strategyId: 1,
                transitionFromStrategyId: 1,
                transitionStartTurn: 1,
                mothballed: 1,
                activeCapacityPercent: 1,
                productionPolicyLevel: 1,
                embargoSuspended: 1,
                embargoExportExposure: 1,
                countryId: 1,
                stateId: 1,
                contractAchievableUnits: 1,
              },
            }
          )
          .toArray(),
        db
          .collection<GameState>("gameState")
          .findOne({ _id: "current" }, { projection: { currentTurn: 1, currentYear: 1 } }),
        db
          .collection<GameConfig>("gameConfig")
          .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } }),
      ]);
      const context = {
        sectors,
        isNatcorp: !!corp.countryOwnerId,
        turn: world?.currentTurn ?? 0,
        currentYear: world?.currentYear,
        commandEconomyEnabled: config?.commandEconomyEnabled === true,
      };
      const snapshot = (commodity: CommodityType, stateId?: string): CapacitySnapshot => {
        const currentCapacityUnits = computeSupplierCommodityCapacityUnits({
          ...context,
          commodity,
          stateId,
        });
        const achievableUnits = computeSupplierCommodityAchievableUnits({
          ...context,
          commodity,
          stateId,
        });
        return {
          currentCapacityUnits,
          maxContractUnits: currentCapacityUnits * CONTRACT_OVERCOMMIT_TOLERANCE,
          achievableUnits,
        };
      };
      const stateIds = supplyAgreementSectorStates(sectors);
      const stateNameById = new Map<string, string>();
      if (stateIds.length > 0) {
        const states = await db
          .collection<State>("states")
          .find({ _id: { $in: stateIds } }, { projection: { name: 1 } })
          .toArray();
        for (const state of states) stateNameById.set(state._id, state.name);
      }
      for (const commodity of COMMODITY_TYPES) {
        if (supportsCorporationWideSupplyAgreement(commodity)) {
          capacityByCommodity[commodity] = snapshot(commodity);
          continue;
        }
        const byState: Record<string, CapacitySnapshot & { stateName: string }> = {};
        for (const stateId of stateIds) {
          const entry = snapshot(commodity, stateId);
          if (!(entry.currentCapacityUnits > 0)) continue;
          byState[stateId] = { ...entry, stateName: stateNameById.get(stateId) ?? stateId };
        }
        capacityByState[commodity] = byState;
      }
    }
    return NextResponse.json({
      agreements: agreements.map((a) => ({
        supplierCorpName:
          counterpartyById.get(a.supplierCorpId.toString())?.name ?? "Unknown corporation",
        supplierCorpTicker: counterpartyById.get(a.supplierCorpId.toString())?.ticker ?? null,
        buyerCorpName:
          counterpartyById.get(a.buyerCorpId.toString())?.name ?? "Unknown corporation",
        buyerCorpTicker: counterpartyById.get(a.buyerCorpId.toString())?.ticker ?? null,
        ...a,
        _id: a._id?.toString(),
        supplierCorpId: a.supplierCorpId.toString(),
        buyerCorpId: a.buyerCorpId.toString(),
        proposedByCorpId: a.proposedByCorpId.toString(),
        currentOffer: serializeOffer(
          a.currentOffer ?? a.offers?.[a.offers.length - 1] ?? legacyOffer(a)
        ),
        offers: (a.offers?.length ? a.offers : [a.currentOffer ?? legacyOffer(a)]).map(
          serializeOffer
        ),
      })),
      capacityByCommodity,
      capacityByState,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** POST: open a new supply-agreement negotiation. */
export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return proposeSupplyAgreement(request, id);
}
