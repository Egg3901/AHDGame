// src/lib/turn/npp/reinvestCandidatePool.ts
/**
 * Unowned-pool lookup and reinvestment candidate shape for NPP capacity builds.
 *
 * The pool rows are the SAME object references the turn shell mutates after
 * each corp's draws, so headroom reads here already reflect what earlier corps
 * in the pass took. No turn-path reads: everything indexes the snapshot the
 * shell already holds.
 */
import type { CorporateSector, UnownedSector } from "@/lib/db/types";
import { unownedHeadroomUnitsOf } from "@/lib/corporations/marketShare";
import { bucketKey } from "@/lib/nationalization/stateControlledBuckets";

/** A sized reinvestment candidate: replacement plus growth units for one sector. */
export interface ReinvestCandidate {
  sector: CorporateSector;
  units: number;
  /**
   * The part of `units` that is genuine market ENTRY (the growth leg) and
   * must therefore be drawn out of the unowned pool. The replacement leg is
   * deliberately NOT in here: it buys back capacity that already existed in
   * this market, so it needs no headroom and draws nothing.
   */
  growthUnits: number;
  fill: number;
  headroomUnits: number;
  interventionPriority: number;
}

/** Pool lookup by (country, state, sectorType), over the shared snapshot. */
export type ReinvestPoolLookup = (
  countryId: string,
  stateId: string,
  sectorType: string
) => UnownedSector | null;

/**
 * Per-country lazy index over the shell's unowned snapshot. Built on first use
 * per country and read after; the indexed row objects stay shared, so draws
 * the shell applies between corps are visible to later lookups.
 */
export function createReinvestPoolLookup(
  unownedByCountry: Map<string, UnownedSector[]>
): ReinvestPoolLookup {
  const poolIndexByCountry = new Map<string, Map<string, UnownedSector>>();
  return (countryId, stateId, sectorType) => {
    let index = poolIndexByCountry.get(countryId);
    if (!index) {
      index = new Map<string, UnownedSector>();
      for (const us of unownedByCountry.get(countryId) ?? []) {
        index.set(bucketKey(us.stateId, us.sectorType), us);
      }
      poolIndexByCountry.set(countryId, index);
    }
    return index.get(bucketKey(stateId, sectorType)) ?? null;
  };
}

/** Headroom units for one sector off the shared pool snapshot, 0 when absent. */
export function reinvestPoolHeadroomUnits(
  poolFor: ReinvestPoolLookup,
  sector: Pick<CorporateSector, "countryId" | "stateId" | "sectorType">,
  corpCountryId: string,
  eraUnitScale: number
): number {
  const pool = poolFor(sector.countryId ?? corpCountryId, sector.stateId, sector.sectorType);
  return pool
    ? unownedHeadroomUnitsOf(sector.sectorType, pool.headroomUnits, pool.revenue, eraUnitScale)
    : 0;
}
