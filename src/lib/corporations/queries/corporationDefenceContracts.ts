import { ObjectId, type Db } from "mongodb";
import { listContractsForCorp } from "@/lib/db/collections/defenceContracts";
import { componentsForStrategy, gradeCeilingFor } from "@/lib/military/arsenalComponents";
import { rawLotsFromSector } from "@/lib/military/arsenal";
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
}

export interface CorporationDefenceView {
  contracts: CorporationContractView[];
  /** Offers awaiting this CEO's answer — nothing is built or billed until they respond. */
  pendingCount: number;
  /** Highest grade this corporation can currently deliver (0..3). */
  gradeCeiling: number;
  /** Total earned from procurement across every contract, live or closed. */
  totalEarned: number;
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
    };
  }

  // One read for every sector the contracts point at, rather than one per contract.
  const sectorIds = [...new Set(contracts.map((c) => c.sectorId.toString()))];
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({ _id: { $in: sectorIds.map((id) => new ObjectId(id)) } })
    .toArray();
  const sectorById = new Map(sectors.map((s) => [s._id.toString(), s]));

  const rows: CorporationContractView[] = contracts.map((c) => {
    const sector = sectorById.get(c.sectorId.toString());
    // Projected output only means something while the plant is still certified for what was
    // ordered; a re-tooled line delivers nothing against this contract.
    const stillCertified =
      sector != null && componentsForStrategy(sector.strategyId).includes(c.component);
    const components = sector ? componentsForStrategy(sector.strategyId) : [];
    const projected =
      stillCertified && sector ? rawLotsFromSector(sector) / Math.max(1, components.length) : 0;

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
    };
  });

  return {
    contracts: rows,
    pendingCount: rows.filter((r) => r.status === "pending").length,
    gradeCeiling: corp ? gradeCeilingFor(corp, currentYear) : 0,
    totalEarned: rows.reduce((s, r) => s + r.earned, 0),
  };
}
