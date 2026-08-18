import { ObjectId, type Db } from "mongodb";
import { listContractsForCorp } from "@/lib/db/collections/defenceContracts";
import { componentsForStrategy, gradeCeilingFor } from "@/lib/military/arsenalComponents";
import { rawLotsFromSector } from "@/lib/military/arsenal";
import {
  contractLotsThisTurn,
  defaultFactoryAllocation,
  lotProductionCost,
  normalizeGrade,
  DEFENCE_FACTORY_SLOTS_PER_PLANT,
  GRADE_PRICE_SCALE,
} from "@/lib/military/defenceLotEconomics";
import { loadDefencePriceRatios } from "@/lib/military/defencePriceRatios";
import { DEFENCE_CARRY_REASON_TEXT, type DefenceCarryReason } from "@/lib/db/types/defenceContract";
import type { Corporation, CorporateSector } from "@/lib/db/types/corporation";

/** One procurement contract as the supplying CEO sees it. */
export interface CorporationContractView {
  _id: string;
  countryId: string;
  component: string;
  lotsOrdered: number;
  lotsDelivered: number;
  pricePerLot: number;
  status: string;
  /** Lots this plant would deliver next turn at its current output. */
  projectedLotsPerTurn: number;
  /** Revenue earned so far — lots delivered × the struck price. */
  earned: number;
  /** Whole lots built and banked but not yet shipped, from `deliveryCarry`. */
  lotsBuiltNotDelivered: number;
  /** Fractional part of a lot still accumulating, 0..1. */
  partialLot: number;
  /** Cash actually received across every delivery. */
  amountPaid: number;
  /** What building those lots cost, so the order book shows margin rather than gross. */
  productionCostPaid: number;
  /**
   * Production cost of ONE lot at current input prices, graded to the contract's ceiling so
   * it matches what delivery will actually charge. Null when the plant no longer exists:
   * an unknown cost must render as unknown, not as a free build.
   */
  unitProductionCost: number | null;
  /** Local currency the buyer still has committed against this order. */
  encumberedAmount: number;
  /** Why the last delivery turn banked output instead of shipping it, in plain text. */
  carryReason?: DefenceCarryReason;
  carryReasonText?: string;
  carryReasonTurn?: number;
  /** Production lines this order holds, and how many the plant has in total. */
  assignedFactories: number;
  totalFactories: number;
  /** The grade this order is written for (0..3). */
  gradeCeiling?: number;
  /** Public disclosure that the awarding minister had an interest in this corporation. */
  selfDealing?: {
    basis: "owner" | "shareholding";
    stakeShare: number;
    ministerName?: string;
  };
}

export interface CorporationDefenceView {
  contracts: CorporationContractView[];
  /** Offers awaiting this CEO's answer — nothing is built or billed until they respond. */
  pendingCount: number;
  /** Highest grade this corporation can currently deliver (0..3). */
  gradeCeiling: number;
  /** Total earned from procurement across every contract, live or closed. */
  totalEarned: number;
  /**
   * Earnings NET of what building the materiel cost. The gross figure alone was actively
   * misleading once deliveries carried a production cost: a corporation could take a fat
   * headline number on a contract it lost money on.
   */
  totalNetMargin: number;
  /** Local currency governments still have committed against this corporation's live orders. */
  totalEncumbered: number;
}

/**
 * A corporation's procurement position: what it is contracted to build, what that is worth,
 * and the ceiling its R&D puts on the quality it can deliver.
 *
 * Deliberately a separate module rather than another block inside
 * `queries/corporationDetail.ts` — that file is 2,000+ lines and grandfathered into the
 * architecture audit's size allowlist with an explicit "do not extend for new code". Adding a
 * new concern there would deepen a decomposition the audit is already asking for.
 */
export async function loadCorporationDefenceContracts(
  db: Db,
  corporationId: ObjectId,
  currentYear: number
): Promise<CorporationDefenceView> {
  const [contracts, corp] = await Promise.all([
    listContractsForCorp(db, corporationId),
    db.collection<Corporation>("corporations").findOne({ _id: corporationId }),
  ]);

  if (contracts.length === 0) {
    return {
      contracts: [],
      pendingCount: 0,
      gradeCeiling: corp ? gradeCeilingFor(corp, currentYear) : 0,
      totalEarned: 0,
      totalNetMargin: 0,
      totalEncumbered: 0,
    };
  }

  // One read for every sector the contracts point at, rather than one per contract.
  const sectorIds = [...new Set(contracts.map((c) => c.sectorId.toString()))];
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({ _id: { $in: sectorIds.map((id) => new ObjectId(id)) } })
    .toArray();
  const sectorById = new Map(sectors.map((s) => [s._id.toString(), s]));
  // One read of the price book, so every row on the order book quotes its break-even against
  // the same market. A CEO comparing two contracts is comparing prices, not read timings.
  const priceRatios = await loadDefencePriceRatios(db);

  const rows: CorporationContractView[] = contracts.map((c) => {
    const sector = sectorById.get(c.sectorId.toString());
    // Projected output only means something while the plant is still certified for what was
    // ordered; a re-tooled line delivers nothing against this contract.
    const stillCertified =
      sector != null && componentsForStrategy(sector.strategyId).includes(c.component);
    const components = sector ? componentsForStrategy(sector.strategyId) : [];
    const assigned =
      c.assignedFactories ??
      defaultFactoryAllocation(components.length, DEFENCE_FACTORY_SLOTS_PER_PLANT);
    const projected =
      stillCertified && sector ? contractLotsThisTurn(rawLotsFromSector(sector), assigned) : 0;
    const carry = Math.max(0, c.deliveryCarry ?? 0);

    return {
      _id: c._id.toString(),
      countryId: c.countryId,
      component: c.component,
      lotsOrdered: c.lotsOrdered,
      lotsDelivered: c.lotsDelivered,
      pricePerLot: c.pricePerLot,
      status: c.status,
      // A pending offer builds nothing yet; the projection is what it WOULD deliver, which
      // is exactly what a CEO needs to judge it by before answering.
      projectedLotsPerTurn: c.status === "active" || c.status === "pending" ? projected : 0,
      earned: c.lotsDelivered * c.pricePerLot,
      // Built-but-unshipped is the number that used to be invisible. Output banked against a
      // short appropriation looked identical to a plant producing nothing, which is how a
      // destroyed lot went unnoticed for a whole ticket cycle.
      lotsBuiltNotDelivered: Math.floor(carry),
      partialLot: carry - Math.floor(carry),
      amountPaid: c.amountPaid ?? c.lotsDelivered * c.pricePerLot,
      productionCostPaid: c.productionCostPaid ?? 0,
      unitProductionCost: sector
        ? (lotProductionCost(sector.strategyId, priceRatios) ?? 0) *
          GRADE_PRICE_SCALE[normalizeGrade(c.gradeCeiling)]
        : null,
      encumberedAmount: c.encumberedAmount ?? 0,
      ...(c.carryReason
        ? {
            carryReason: c.carryReason,
            carryReasonText: DEFENCE_CARRY_REASON_TEXT[c.carryReason],
            carryReasonTurn: c.carryReasonTurn,
          }
        : {}),
      assignedFactories: assigned,
      totalFactories: DEFENCE_FACTORY_SLOTS_PER_PLANT,
      ...(c.gradeCeiling != null ? { gradeCeiling: c.gradeCeiling } : {}),
      ...(c.selfDealing
        ? {
            selfDealing: {
              basis: c.selfDealing.basis,
              stakeShare: c.selfDealing.stakeShare,
              ministerName: c.selfDealing.ministerName,
            },
          }
        : {}),
    };
  });

  return {
    contracts: rows,
    pendingCount: rows.filter((r) => r.status === "pending").length,
    gradeCeiling: corp ? gradeCeilingFor(corp, currentYear) : 0,
    totalEarned: rows.reduce((s, r) => s + r.earned, 0),
    totalNetMargin: rows.reduce((s, r) => s + r.amountPaid - r.productionCostPaid, 0),
    totalEncumbered: rows.reduce((s, r) => s + r.encumberedAmount, 0),
  };
}
