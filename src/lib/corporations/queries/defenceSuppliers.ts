import { ObjectId, type Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types/corporation";
import type { UnitDomain } from "@/lib/db/types/militaryUnit";
import { resolveFillEligibility } from "@/lib/military/defenceFillEligibility";
import {
  lotProductionCost,
  defaultFactoryAllocation,
  DEFENCE_FACTORY_SLOTS_PER_PLANT,
} from "@/lib/military/defenceLotEconomics";
import { componentsForStrategy } from "@/lib/military/arsenalComponents";
import { listOpenContracts } from "@/lib/db/collections/defenceContracts";

/** One plant the defence minister could award a contract to. */
export interface DefenceSupplierView {
  sectorId: string;
  corporationId: string;
  corporationName: string;
  /** The plant's own name if its CEO gave it one, else where it sits — a corporation with
   *  three defence lines is otherwise three identical rows. */
  plantLabel: string;
  strategyId: string;
  /** The component a contract here would be written against — the route picks `[0]` too. */
  component: UnitDomain;
  /** Every domain this line is certified for; a two-domain plant splits its output. */
  components: UnitDomain[];
  /** Lots it would deliver next turn at current output, after the multi-domain split. */
  projectedLotsPerTurn: number;
  /** Best grade its parent's R&D can currently deliver (0..3). */
  gradeCeiling: number;
  /** True when this plant already carries an active contract. */
  alreadyContracted: boolean;
  /** Lots this supplier may still receive in the current budget window. */
  availableLots?: number;
  allowanceWindowEndTurn?: number;
  /**
   * What one lot costs this plant to build, at current input prices. The floor of the price
   * band the minister may negotiate inside (suggestion #291) is this plus a margin.
   */
  unitProductionCost: number;
  /** Production lines this plant has free, out of its total (suggestion #281). */
  freeFactories: number;
  totalFactories: number;
}

/**
 * Plants this country's defence minister may award a procurement contract to.
 *
 * The filters here are a deliberate mirror of the award route's own rejections — defence
 * sector, a strategy that maps to at least one component, and `canSupply` for the domestic
 * currency rule. A picker that offered a plant the route would refuse would turn every one of
 * those clear 400s into a dead option the minister cannot diagnose.
 *
 * `alreadyContracted` marks rather than removes: a second contract on one plant is legal (its
 * output is split across them), but it is rarely what a minister means to do, so the decision
 * belongs to them with the fact in front of it.
 */
export async function listDefenceSuppliers(
  db: Db,
  countryId: string,
  currentYear: number
): Promise<DefenceSupplierView[]> {
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({ sectorType: "defense", countryId: countryId as CorporateSector["countryId"] })
    .toArray();
  if (sectors.length === 0) return [];

  const corpIds = [...new Set(sectors.map((s) => s.corporationId.toString()))];
  const corps = await db
    .collection<Corporation>("corporations")
    .find({ _id: { $in: corpIds.map((id) => new ObjectId(id)) } })
    .toArray();
  const corpById = new Map(corps.map((c) => [c._id.toString(), c]));

  // Open, not active: a plant already sitting on an unanswered offer is just as committed
  // from the minister's point of view as one already building.
  const active = await listOpenContracts(db, countryId);
  const contractedSectorIds = new Set(active.map((c) => c.sectorId.toString()));

  // Lines already committed per plant, so the picker can tell a minister that a plant is
  // productive but fully booked - a distinction it could not previously make at all.
  const committedSlots = new Map<string, number>();
  for (const c of active) {
    const key = c.sectorId.toString();
    const sector = sectors.find((s) => s._id.toString() === key);
    const fallback = defaultFactoryAllocation(
      componentsForStrategy(sector?.strategyId).length,
      DEFENCE_FACTORY_SLOTS_PER_PLANT
    );
    committedSlots.set(key, (committedSlots.get(key) ?? 0) + (c.assignedFactories ?? fallback));
  }

  const rows: DefenceSupplierView[] = [];
  for (const sector of sectors) {
    const corp = corpById.get(sector.corporationId.toString());
    if (!corp) continue;

    // The SAME resolver the award route and the delivery sweep use. A picker that offered a
    // plant the route would refuse turned every clear 400 into a dead option the minister
    // could not diagnose, and every divergence between these checks has shipped as a ticket.
    const fill = resolveFillEligibility({ corp, sector, countryId, currentYear });
    if (!fill.eligible) continue;

    const freeFactories = Math.max(
      0,
      DEFENCE_FACTORY_SLOTS_PER_PLANT - (committedSlots.get(sector._id.toString()) ?? 0)
    );

    rows.push({
      sectorId: sector._id.toString(),
      corporationId: corp._id.toString(),
      corporationName: corp.name ?? "Unnamed corporation",
      plantLabel: sector.displayName?.trim() || sector.stateId,
      strategyId: sector.strategyId ?? "standard",
      component: fill.components[0],
      components: fill.components,
      projectedLotsPerTurn: fill.projectedLotsPerTurn,
      gradeCeiling: fill.gradeCeiling,
      alreadyContracted: contractedSectorIds.has(sector._id.toString()),
      unitProductionCost: lotProductionCost(sector.strategyId) ?? 0,
      freeFactories,
      totalFactories: DEFENCE_FACTORY_SLOTS_PER_PLANT,
    });
  }

  // Most productive first: the minister's question is almost always "who can actually fill
  // this", and an uncontracted plant beats an already-committed one at equal output.
  rows.sort(
    (a, b) =>
      Number(a.alreadyContracted) - Number(b.alreadyContracted) ||
      b.projectedLotsPerTurn - a.projectedLotsPerTurn
  );
  return rows;
}
