import type { CommodityType } from "@/lib/constants/commodities";
import type { Corporation, CorporateSector } from "@/lib/db/types/corporation";
import { resolveFillEligibility } from "@/lib/military/defenceFillEligibility";
import { lotPriceBand, lotProductionCost } from "@/lib/military/defenceLotEconomics";
import { defenceSupplierCapShare } from "@/lib/military/defenceContractLimits";
import { defenceBidError, extractionBidError } from "../rules";
import type { TenderTerms } from "../types";

type Supplier = Pick<
  Corporation,
  "type" | "countryId" | "liquidCurrencyCode" | "unlockedTechNodeIds" | "techDecadeLane"
>;
type Plant = Pick<CorporateSector, "strategyId" | "revenue" | "sectorType" | "stateId">;

/** Discovery uses the same bid checks at the lowest qualifying price, without selecting a bid. */
export function hasTenderOpportunity(input: {
  terms: TenderTerms;
  countryId: string;
  corporation: Supplier;
  sectors: Plant[];
  year: number;
  maximumGrade: number;
  anchor: number | null;
  ratios: ReadonlyMap<CommodityType, number>;
  procurementNotional: number;
  supplierAmount: number;
  stateOwned: boolean;
}): boolean {
  const { terms, corporation: corp } = input;
  if (terms.type === "extraction")
    return (
      extractionBidError({
        corporationType: corp.type,
        hasOperations: input.sectors.some((s) => s.stateId === terms.stateId),
        amount: terms.minimumSigningFeeAnchor,
        minimum: terms.minimumSigningFeeAnchor,
      }) === null
    );
  if (input.anchor == null) return false;
  return input.sectors.some((sector) => {
    if (sector.sectorType !== "defense") return false;
    const fill = resolveFillEligibility({
      corp,
      sector,
      countryId: input.countryId,
      currentYear: input.year,
      component: terms.component,
    });
    if (!fill.eligible) return false;
    const cost = lotProductionCost(sector.strategyId, input.anchor!, input.ratios);
    const band =
      cost == null
        ? null
        : lotPriceBand({
            anchorPrice: input.anchor!,
            productionCost: cost,
            grade: terms.grade,
          });
    if (!band) return false;
    const remaining = Math.floor(
      Math.max(
        0,
        input.procurementNotional * defenceSupplierCapShare(input.stateOwned) - input.supplierAmount
      ) / band.floor
    );
    return (
      defenceBidError({
        supplierGrade: fill.gradeCeiling,
        eraGrade: input.maximumGrade,
        requiredGrade: terms.grade,
        amount: band.floor,
        maximum: terms.maximumPricePerLot,
        floor: band.floor,
        ceiling: band.ceiling,
        supplierRemainingLots: remaining,
        lots: terms.lots,
      }) === null
    );
  });
}
