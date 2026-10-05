/** Pure title reach and delivery allocation rules for existing media output. */
import type { CommodityType } from "@/lib/constants/commodities";
import type { SectorClearingResult } from "@/lib/market/clearing";
import type { MediaProductKind } from "@/lib/products/mediaProductCatalog";
import { getMediaProductKind, tailDemandFactor } from "@/lib/products/mediaProductCatalog";
import type { MediaProductProject } from "@/lib/products/mediaProduct";

export interface MediaProductDeliveryAttribution {
  projectId: string;
  corporationId: string;
  turn: number;
  deliveredUnitsByCommodity: Partial<Record<CommodityType, number>>;
  deliveredRevenueAnchorByCommodity: Partial<Record<CommodityType, number>>;
}

export interface PaidPoliticalMediaSellerAmount {
  units: number;
  amountAnchor: number;
}

export interface PaidPoliticalMediaSellerReceipt extends PaidPoliticalMediaSellerAmount {
  allocationId: string;
}

export function paidPoliticalMediaSellerReceipts(input: {
  orderId: string;
  sellers: readonly (PaidPoliticalMediaSellerReceipt & { sectorId: string })[];
  results: readonly { status: string }[];
  orderAlreadySettled?: boolean;
}): Array<PaidPoliticalMediaSellerReceipt & { sectorId: string }> {
  const seenAllocationIds = new Set<string>();
  return input.sellers.filter((seller, index) => {
    if (
      !seller.sectorId ||
      !seller.allocationId ||
      !Number.isFinite(seller.units) ||
      seller.units <= 0 ||
      !Number.isFinite(seller.amountAnchor) ||
      seller.amountAnchor <= 0
    ) {
      return false;
    }
    const status = input.results[index]?.status;
    if (input.orderAlreadySettled !== true && status !== "applied" && status !== "replayed") {
      return false;
    }
    const identity = `${input.orderId}:${seller.allocationId}`;
    if (seenAllocationIds.has(identity)) return false;
    seenAllocationIds.add(identity);
    return true;
  });
}

/** Remove planned political fills and restore only seller receipts that applied. */
export function reconcileMediaProductDelivery(input: {
  clearing: SectorClearingResult;
  plannedPoliticalUnits: number;
  paidPoliticalSeller: PaidPoliticalMediaSellerAmount;
}): {
  clearing: SectorClearingResult;
  paidPoliticalUnitsByCommodity: Partial<Record<CommodityType, number>>;
  paidPoliticalRevenueAnchorByCommodity: Partial<Record<CommodityType, number>>;
} {
  const deliveredUnitsByCommodity = { ...input.clearing.deliveredUnitsByCommodity };
  const commercialAndPaidUnits = deliveredUnitsByCommodity.advertising ?? 0;
  const plannedPoliticalUnits = Number.isFinite(input.plannedPoliticalUnits)
    ? Math.max(0, input.plannedPoliticalUnits)
    : 0;
  const paidPoliticalUnits = Number.isFinite(input.paidPoliticalSeller.units)
    ? Math.max(0, input.paidPoliticalSeller.units)
    : 0;
  const paidPoliticalRevenue = Number.isFinite(input.paidPoliticalSeller.amountAnchor)
    ? Math.max(0, input.paidPoliticalSeller.amountAnchor)
    : 0;
  deliveredUnitsByCommodity.advertising = Math.max(
    0,
    commercialAndPaidUnits - plannedPoliticalUnits + paidPoliticalUnits
  );
  return {
    clearing: { ...input.clearing, deliveredUnitsByCommodity },
    paidPoliticalUnitsByCommodity: { advertising: paidPoliticalUnits },
    paidPoliticalRevenueAnchorByCommodity: { advertising: paidPoliticalRevenue },
  };
}

interface MediaProductOfferPlan {
  availabilityByCommodity: Partial<Record<CommodityType, number>>;
  titleShareByProjectId: Map<string, Partial<Record<CommodityType, number>>>;
}

function buildMediaProductOfferPlan(
  projects: readonly MediaProductProject[]
): MediaProductOfferPlan {
  const availabilityByCommodity: Partial<Record<CommodityType, number>> = {};
  const titleShareByProjectId = new Map<string, Partial<Record<CommodityType, number>>>();
  const ordered = [...projects].sort((a, b) => a._id.localeCompare(b._id));
  const commodities = new Set<MediaProductKind["outputCommodities"][number]>();
  for (const project of ordered) {
    const kind = getMediaProductKind(project.kindId);
    if (kind) for (const commodity of kind.outputCommodities) commodities.add(commodity);
  }
  for (const commodity of commodities) {
    let reservedShare = 0;
    let titleAvailableShare = 0;
    for (const project of ordered) {
      if (project.stage === "retired") continue;
      const kind = getMediaProductKind(project.kindId);
      if (!kind?.outputCommodities.includes(commodity)) continue;
      const allocation = Number.isFinite(project.allocationShare)
        ? Math.min(1 - reservedShare, Math.max(0, project.allocationShare))
        : 0;
      reservedShare += allocation;
      const stageAvailability =
        project.stage === "development"
          ? 0
          : project.stage === "decline"
            ? tailDemandFactor(project.stage, kind.tail)
            : 1;
      const titleShare = allocation * kind.coverage * stageAvailability;
      titleAvailableShare += titleShare;
      const byCommodity = titleShareByProjectId.get(project._id) ?? {};
      byCommodity[commodity] = titleShare;
      titleShareByProjectId.set(project._id, byCommodity);
    }
    availabilityByCommodity[commodity] = Math.max(
      0,
      Math.min(1, 1 - reservedShare + titleAvailableShare)
    );
  }
  return { availabilityByCommodity, titleShareByProjectId };
}

/** Keep title reach inside the sector's existing physical offer before clearing. */
export function mediaProductOfferAvailability(
  projects: readonly MediaProductProject[]
): Partial<Record<CommodityType, number>> {
  return buildMediaProductOfferPlan(projects).availabilityByCommodity;
}

/** Allocate only actual cleared sector sales to titles, with no added units or cash. */
export function attributeMediaProductSales(input: {
  projects: readonly MediaProductProject[];
  clearing: SectorClearingResult | undefined;
  basePrices: Partial<Record<CommodityType, number>>;
  turn: number;
  strategyId?: string;
  paidPoliticalUnitsByCommodity?: Partial<Record<CommodityType, number>>;
  paidPoliticalRevenueAnchorByCommodity?: Partial<Record<CommodityType, number>>;
}): MediaProductDeliveryAttribution[] {
  if (!Number.isSafeInteger(input.turn) || input.turn < 0 || !input.clearing) return [];
  const eligibleProjects = input.strategyId
    ? input.projects.filter(
        (project) => getMediaProductKind(project.kindId)?.modelId === input.strategyId
      )
    : input.projects;
  const offerPlan = buildMediaProductOfferPlan(eligibleProjects);
  const attributions: MediaProductDeliveryAttribution[] = [];
  for (const project of [...eligibleProjects].sort((a, b) => a._id.localeCompare(b._id))) {
    if (project.stage === "retired") continue;
    const deliveredUnitsByCommodity: Partial<Record<CommodityType, number>> = {};
    const deliveredRevenueAnchorByCommodity: Partial<Record<CommodityType, number>> = {};
    const titleShares = offerPlan.titleShareByProjectId.get(project._id) ?? {};
    const kind = getMediaProductKind(project.kindId);
    if (!kind) continue;
    for (const commodity of kind.outputCommodities) {
      const totalDelivered = input.clearing.deliveredUnitsByCommodity?.[commodity] ?? 0;
      const paidPoliticalUnits = Math.min(
        Math.max(0, totalDelivered),
        Math.max(0, input.paidPoliticalUnitsByCommodity?.[commodity] ?? 0)
      );
      const totalAvailability = offerPlan.availabilityByCommodity[commodity] ?? 1;
      const titleShare = titleShares[commodity] ?? 0;
      const titleRevenueShare = totalAvailability > 0 ? titleShare / totalAvailability : 0;
      const units = totalAvailability > 0 ? Math.max(0, totalDelivered) * titleRevenueShare : 0;
      const unitPriceFactor = input.clearing.offerFactorByCommodity?.[commodity] ?? 0;
      const basePrice = input.basePrices[commodity] ?? 0;
      const commercialRevenue =
        Number.isFinite(unitPriceFactor) &&
        unitPriceFactor > 0 &&
        Number.isFinite(basePrice) &&
        basePrice > 0
          ? Math.max(0, units - paidPoliticalUnits * titleRevenueShare) *
            basePrice *
            unitPriceFactor
          : 0;
      const paidPoliticalRevenue = Math.max(
        0,
        input.paidPoliticalRevenueAnchorByCommodity?.[commodity] ?? 0
      );
      const revenue = commercialRevenue + paidPoliticalRevenue * titleRevenueShare;
      deliveredUnitsByCommodity[commodity] = units;
      deliveredRevenueAnchorByCommodity[commodity] = Number.isFinite(revenue) ? revenue : 0;
    }
    attributions.push({
      projectId: project._id,
      corporationId: project.corporationId,
      turn: input.turn,
      deliveredUnitsByCommodity,
      deliveredRevenueAnchorByCommodity,
    });
  }
  return attributions;
}
