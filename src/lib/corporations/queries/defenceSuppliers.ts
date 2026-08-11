import { ObjectId, type Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types/corporation";
import type { UnitDomain } from "@/lib/db/types/militaryUnit";
import { componentsForStrategy, gradeCeilingFor } from "@/lib/military/arsenalComponents";
import { lotsFromSector } from "@/lib/military/arsenal";
import { canSupply } from "@/lib/turn/defenceDeliveryTurn";
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

  const rows: DefenceSupplierView[] = [];
  for (const sector of sectors) {
    const corp = corpById.get(sector.corporationId.toString());
    if (!corp || !canSupply(corp, countryId)) continue;

    // `cyber` maps to nothing — electronics and software, not materiel — so those plants are
    // absent here for the same reason the route refuses them.
    const components = componentsForStrategy(sector.strategyId);
    if (components.length === 0) continue;

    rows.push({
      sectorId: sector._id.toString(),
      corporationId: corp._id.toString(),
      corporationName: corp.name ?? "Unnamed corporation",
      plantLabel: sector.displayName?.trim() || sector.stateId,
      strategyId: sector.strategyId ?? "standard",
      component: components[0],
      components,
      projectedLotsPerTurn: Math.floor(lotsFromSector(sector) / Math.max(1, components.length)),
      gradeCeiling: gradeCeilingFor(corp, currentYear),
      alreadyContracted: contractedSectorIds.has(sector._id.toString()),
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
