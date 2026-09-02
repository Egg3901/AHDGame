/**
 * P3a — the build queue's turn.
 *
 * Split out of `sectorTurn.ts`, which crossed the 2000 LOC architecture block
 * threshold. This block was the cleanest seam in it: a self-contained
 * computation with explicit inputs and no writes, whose only product is the set
 * of values below. Nothing here reaches the database or mutates the sector —
 * `sectorTurn` still owns every write, including the delta-based queue update
 * that has to stay there because it is part of one bulk op.
 *
 * Orders whose `onlineTurn` has arrived convert into capacity and leave the
 * queue; the rest stay outstanding and keep their paid cost in CIP (D10).
 */
import type { CorporateSector, SectorBuildOrder } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  CAPACITY_ANCHOR_YEAR,
  CAPACITY_BUILD_TURNS,
  capacityPricePerUnit,
} from "@/lib/constants/capacityEconomy";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import {
  costReleasedThisTurn,
  queueUndeliveredCost,
  unitsDeliveredThisTurn,
} from "@/lib/corporations/buildDelivery";

export interface BuildQueueTurnArgs {
  sector: CorporateSector;
  currentTurn: number;
  plantsEnabled: boolean;
  /** Absent in a test/simulation harness; see the anchor-year note below. */
  currentYear: number | null | undefined;
  sectorCurrencyCode: CurrencyCode | undefined;
  sectorFxRate: number;
  eraUnitScale: number;
}

export interface BuildQueueTurn {
  /** The sector's first turn under plants — no `plantsStartTurn` recorded yet. */
  isFlipTurn: boolean;
  /** The stored queue, minus rows too malformed to deliver. */
  existingQueue: SectorBuildOrder[];
  /** Capacity converting into `capitalStock` this turn. */
  landedBuildUnits: number;
  /** The cash those landing orders consumed, leaving CIP this turn. */
  landedBuildCostAnchor: number;
  /** Orders still outstanding after this turn's deliveries. */
  outstandingOrders: SectorBuildOrder[];
  /** The flip-turn growth-ramp conversion, when one is owed. */
  flipGrowthCreditOrder: SectorBuildOrder | null;
  /** `outstandingOrders` plus the flip credit — a SNAPSHOT, never `$set`. */
  nextBuildQueue: SectorBuildOrder[];
  /** Cost still under construction after this turn. */
  constructionInProgressAnchor: number;
  /** Standing build price per unit, also used by the paid-basis block. */
  capacityUnitPriceAnchor: number;
}

export function resolveBuildQueueTurn(args: BuildQueueTurnArgs): BuildQueueTurn {
  const {
    sector,
    currentTurn,
    plantsEnabled,
    currentYear,
    sectorCurrencyCode,
    sectorFxRate,
    eraUnitScale,
  } = args;

  const isFlipTurn = plantsEnabled && sector.plantsStartTurn == null;
  const existingQueue: SectorBuildOrder[] = Array.isArray(sector.buildQueue)
    ? sector.buildQueue.filter(
        (o) =>
          o != null && Number.isFinite(o.unitsOrdered) && o.unitsOrdered > 0 && o.onlineTurn != null
      )
    : [];
  // A legacy order delivers its whole `unitsOrdered` the turn it comes due; a
  // `smooth` order delivers only this turn's slice, so a large build ramps in
  // instead of landing as one lump (see buildDelivery.ts). Both sum identically.
  const landedBuildUnits = plantsEnabled
    ? existingQueue.reduce((sum, o) => sum + unitsDeliveredThisTurn(o, currentTurn), 0)
    : 0;
  // P5: this cash leaves CIP this turn (the orders leave the queue), so it has
  // to arrive somewhere or the sector's paid basis silently drops to zero the
  // moment its plant comes online. It arrives in `capacityBookAnchor`.
  const landedBuildCostAnchor = plantsEnabled
    ? existingQueue.reduce((sum, o) => sum + costReleasedThisTurn(o, currentTurn), 0)
    : 0;
  const outstandingOrders = plantsEnabled
    ? existingQueue.filter((o) => o.onlineTurn > currentTurn)
    : existingQueue;

  // Growth-ramp flip conversion: a sector that was mid-ramp when plants landed
  // had been PAYING for capacity the legacy growth path would have delivered
  // continuously. Plants stops delivering it (capacity no longer grows off the
  // slider), so without compensation that spend is simply confiscated. Convert
  // the accrued daily growth spend into capacity at the standing build price
  // and deliver it as a FREE queue order (costPaidAnchor 0 — the corp already
  // paid, and it must not be refundable via cancel), at half the normal build
  // time since the legacy build was already partly under way.
  const growthCostAnchorForFlip = readCorpEconomicAnchor(
    Number.isFinite(sector.currentGrowthCost) ? (sector.currentGrowthCost ?? 0) : 0,
    sectorCurrencyCode,
    sectorFxRate
  );
  // `currentYear` is always supplied by the live turn; fall back to the
  // calibration anchor year (era index 1.0) rather than to the modern row, so a
  // year-less test/simulation harness prices the conversion at the anchor
  // instead of silently handing out 5× fewer units.
  const capacityUnitPriceAnchor = capacityPricePerUnit(
    sector.sectorType,
    currentYear ?? CAPACITY_ANCHOR_YEAR,
    eraUnitScale
  );
  // C10: the credit keys on the ACCRUED COST, not on the target slider.
  // `currentGrowthCost` is what the sector is being billed THIS turn;
  // `targetGrowthRate` is where the owner has pointed the slider NEXT. A player
  // who winds the slider back to 0 still pays a decaying `currentGrowthRate`
  // for several turns, so gating on the target confiscated exactly the spend of
  // the players who had already stopped growing. If cost was charged, capacity
  // is owed.
  const flipGrowthCreditOrder: SectorBuildOrder | null =
    isFlipTurn && growthCostAnchorForFlip > 0 && capacityUnitPriceAnchor > 0
      ? {
          unitsOrdered: growthCostAnchorForFlip / capacityUnitPriceAnchor,
          costPaidAnchor: 0,
          startTurn: currentTurn,
          onlineTurn: currentTurn + Math.ceil(CAPACITY_BUILD_TURNS(sector.sectorType) / 2),
          smooth: true,
        }
      : null;
  const nextBuildQueue: SectorBuildOrder[] = flipGrowthCreditOrder
    ? [...outstandingOrders, flipGrowthCreditOrder]
    : outstandingOrders;
  // CIP is the cost still UNDER construction. For a legacy order that is its
  // whole `costPaidAnchor` until it lands; for a `smooth` order it is the cost
  // of the units not yet delivered, which falls a slice at a time. The command
  // restates this exact figure absolutely on every build/cancel, so the two
  // agree and any rounding drift self-heals.
  const constructionInProgressAnchor = queueUndeliveredCost(nextBuildQueue, currentTurn);

  return {
    isFlipTurn,
    existingQueue,
    landedBuildUnits,
    landedBuildCostAnchor,
    outstandingOrders,
    flipGrowthCreditOrder,
    nextBuildQueue,
    constructionInProgressAnchor,
    capacityUnitPriceAnchor,
  };
}
