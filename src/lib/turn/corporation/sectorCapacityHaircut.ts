import type { CorporateSector } from "@/lib/db/types";
import type { ExtractableResource } from "@/lib/constants/commodities";
import {
  capacityHaircutFactor,
  EXTRACTION_CAPACITY_HAIRCUT_FLOOR,
  EXTRACTION_CAPACITY_HAIRCUT_TURNS,
  noBuyerHaircutFloor,
  RAMP_REANCHOR_DELTA,
} from "@/lib/extraction/capacityHaircut";

export function resolveSectorCapacityHaircut(
  sector: CorporateSector,
  extractionCapacityUtilBySector: ReadonlyMap<
    string,
    { utilization: number; bindingResource: ExtractableResource | null }
  >,
  currentTurn: number,
  /**
   * Progress through the no-buyer phase-out for a mine whose recipe has no leg
   * its state can extract, 0 for every other sector. Closes the deposit ramp
   * and lowers the 0.5 floor to 0 together, over 24 turns.
   */
  noBuyerProgress: number = 0
): {
  capacityUtil: { utilization: number; bindingResource: ExtractableResource | null };
  capacityHaircutStartTurn: number | undefined;
  capacityHaircut: number;
} {
  // Extraction capacity haircut: a sector that can only extract a fraction of
  // its revenue-based output realizes only that fraction of resource revenue.
  // Ramped in over EXTRACTION_CAPACITY_HAIRCUT_TURNS from the sector's first
  // exposure so it doesn't insta-bankrupt miners (audit t786). Applied to
  // realized output (hourlyRevenue), NOT the stored revenue base — mirrors the
  // nationalization transition so the growth trajectory stays clean.
  const capacityUtil =
    sector.sectorType === "extraction"
      ? (extractionCapacityUtilBySector.get(sector._id.toString()) ?? {
          utilization: 1,
          bindingResource: null,
        })
      : { utilization: 1, bindingResource: null as ExtractableResource | null };
  // Stamp the ramp start the first time an extraction sector is under-utilized.
  // First-exposure stamping cannot see a later, much larger correction. Reset
  // the anchor after a large one-turn utilization drop so that new exposure
  // eases in over the full window instead of landing as an immediate cliff.
  // Maturity gate: only a MATURED ramp may re-anchor. Without it, a sector
  // whose utilization sawtooths by more than the delta every few turns would
  // reset forever and never accrue haircut, silently disabling the clamp.
  const rampAgeTurns = currentTurn - (sector.capacityHaircutStartTurn ?? currentTurn);
  const capacityUtilizationDroppedSharply =
    sector.sectorType === "extraction" &&
    typeof sector.capacityUtilization === "number" &&
    sector.capacityUtilization - capacityUtil.utilization > RAMP_REANCHOR_DELTA &&
    rampAgeTurns >= EXTRACTION_CAPACITY_HAIRCUT_TURNS;
  const capacityHaircutStartTurn =
    sector.sectorType === "extraction" && capacityUtil.utilization < 1
      ? capacityUtilizationDroppedSharply
        ? currentTurn
        : (sector.capacityHaircutStartTurn ?? currentTurn)
      : sector.capacityHaircutStartTurn;
  const capacityHaircut = capacityHaircutFactor(
    capacityUtil.utilization,
    capacityHaircutStartTurn,
    currentTurn,
    noBuyerProgress > 0 ? noBuyerHaircutFloor(noBuyerProgress) : EXTRACTION_CAPACITY_HAIRCUT_FLOOR,
    noBuyerProgress
  );

  return { capacityUtil, capacityHaircutStartTurn, capacityHaircut };
}
