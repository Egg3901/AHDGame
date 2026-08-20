import type { Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types/corporation";
import type { UnitDomain } from "@/lib/db/types/militaryUnit";
import { canSupply, resolveFillEligibility } from "@/lib/military/defenceFillEligibility";
import {
  lotProductionCost,
  defaultFactoryAllocation,
  awardFactoryAllocation,
  DEFENCE_FACTORY_SLOTS_PER_PLANT,
} from "@/lib/military/defenceLotEconomics";
import { componentsForStrategy } from "@/lib/military/arsenalComponents";
import { loadDefencePriceRatios } from "@/lib/military/defencePriceRatios";
import { listOpenContracts } from "@/lib/db/collections/defenceContracts";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";

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
  /** True when this is a National Corporation. The ministerial window then has no private cap. */
  stateOwned: boolean;
}

/**
 * Plants this country's defence minister may award a procurement contract to.
 *
 * The filters here are a deliberate mirror of the award route's own rejections — defence
 * sector, a strategy that maps to at least one component, and `canSupply` for the domestic
 * currency rule. A picker that offered a plant the route would refuse would turn every one of
 * those clear 400s into a dead option the minister cannot diagnose.
 *
 * Domestic is the CORPORATION, not the plant's host state (ticket #1149). `canSupply` and
 * the delivery sweep both key on corp HQ / currency; filtering sectors by `countryId` hid
 * every overseas works of a home-country supplier, so a UK minister could only award
 * Streibl's tiny East-of-England line while the same corp's Greek and French plants — which
 * delivery would have honoured — never appeared.
 *
 * `alreadyContracted` marks rather than removes: a second contract on one plant is legal (its
 * output is split across them), but it is rarely what a minister means to do, so the decision
 * belongs to them with the fact in front of it.
 */
export async function listDefenceSuppliers(
  db: Db,
  countryId: string,
  currentYear: number,
  /**
   * The country's anchored lot price. Build cost is a share of it (ticket #1134), so the
   * picker cannot quote a cost without it. A null or unusable price yields a zero cost, which
   * is what the caller already shows when a country has no usable GDP.
   */
  anchorPrice: number | null
): Promise<DefenceSupplierView[]> {
  // Corps first, then their defence plants anywhere. Plant location is not a payment
  // constraint: a UK corporation banking in pounds can be paid from the UK appropriation
  // whether the works sit in Kent or Attica. The old sector-country filter implemented
  // the opposite of `resolveFillEligibility` and is what ticket #1149 was looking at.
  const corps = await db
    .collection<Corporation>("corporations")
    .find({ countryId: countryId as Corporation["countryId"] })
    .toArray();
  const eligibleCorps = corps.filter((c) => canSupply(c, countryId));
  if (eligibleCorps.length === 0) return [];

  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({
      sectorType: "defense",
      corporationId: { $in: eligibleCorps.map((c) => c._id) },
    })
    .toArray();
  if (sectors.length === 0) return [];
  const corpById = new Map(eligibleCorps.map((c) => [c._id.toString(), c]));

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

  // One read of the price book for the whole picker, so every plant in the list is quoted
  // against the same market rather than each against whatever it happened to read.
  const priceRatios = await loadDefencePriceRatios(db);

  const rows: DefenceSupplierView[] = [];
  for (const sector of sectors) {
    const corp = corpById.get(sector.corporationId.toString());
    if (!corp) continue;

    const committed = committedSlots.get(sector._id.toString()) ?? 0;
    const freeFactories = Math.max(0, DEFENCE_FACTORY_SLOTS_PER_PLANT - committed);
    const stateOwned = isStateOwned(corp);
    // Ticket #1134: project what the award will actually assign. A vacant NatCorp CEO
    // cannot re-allocate, so the picker must not advertise a half-plant rate the order
    // will then double.
    const assignedForProjection = awardFactoryAllocation({
      componentCount: componentsForStrategy(sector.strategyId).length,
      freeSlots: freeFactories > 0 ? freeFactories : DEFENCE_FACTORY_SLOTS_PER_PLANT,
      stateOwned,
    });

    // The SAME resolver the award route and the delivery sweep use. A picker that offered a
    // plant the route would refuse turned every clear 400 into a dead option the minister
    // could not diagnose, and every divergence between these checks has shipped as a ticket.
    const fill = resolveFillEligibility({
      corp,
      sector,
      countryId,
      currentYear,
      assignedFactories: assignedForProjection,
    });
    if (!fill.eligible) continue;

    rows.push({
      sectorId: sector._id.toString(),
      corporationId: corp._id.toString(),
      corporationName: corp.name ?? "Unnamed corporation",
      plantLabel: plantLabelFor(sector, countryId),
      strategyId: sector.strategyId ?? "standard",
      component: fill.components[0],
      components: fill.components,
      projectedLotsPerTurn: fill.projectedLotsPerTurn,
      gradeCeiling: fill.gradeCeiling,
      alreadyContracted: contractedSectorIds.has(sector._id.toString()),
      unitProductionCost:
        anchorPrice != null
          ? (lotProductionCost(sector.strategyId, anchorPrice, priceRatios) ?? 0)
          : 0,
      freeFactories,
      totalFactories: DEFENCE_FACTORY_SLOTS_PER_PLANT,
      stateOwned,
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

/**
 * Where the works sit, with the host country when that is not the buyer — otherwise a UK
 * minister looking at three Streibl rows cannot tell Kent from Attica.
 */
function plantLabelFor(
  sector: Pick<CorporateSector, "displayName" | "stateId" | "countryId">,
  buyerCountryId: string
): string {
  const base = sector.displayName?.trim() || sector.stateId;
  return sector.countryId !== buyerCountryId ? `${base} (${sector.countryId})` : base;
}
