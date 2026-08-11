/**
 * How many capacity units one nameable FACILITY is.
 *
 * The engine's capacity unit is "one output unit per day", and its ₳ value is
 * the sector's RPU — which for cheap-commodity mixes is tiny (an energy unit
 * nameplates ~₳92/day, extraction ~₳89) and for expensive ones huge (an
 * automobile unit ~₳50,000/day). The interface inherited that unit raw, so the
 * build dialog sold "power stations" worth ₳92 a day and a player had to order
 * hundreds of them before the money meant anything. The noun was attached to
 * something 1/280th the size of the thing it names.
 *
 * This table fixes the QUANTUM, not the economics: one facility =
 * `plantSizeUnits(type)` capacity units, sized so a facility's nameplate lands
 * near {@link FACILITY_TARGET_DAILY_REVENUE_ANCHOR} of daily revenue whatever
 * the sector's mix prices at. The build dialog counts and prices in
 * facilities; the API, the engine, storage and market share stay in units.
 * Nothing here is persisted or read by the turn.
 *
 * ERA-INVARIANT BY CONSTRUCTION. Under the era unit basis
 * (`getEraUnitScale`), a 1953 world's RPU and its "meaningful daily revenue"
 * both shrink by the same nominal ratio, so units-per-facility — their
 * quotient — is the same number in every era. One authored table serves all
 * worlds; do not add an era dimension here.
 *
 * VALUES ARE AUTHORED, NOT COMPUTED, so a base-price tuning pass cannot
 * silently resize every facility in the game. `facilityQuantum.test.ts` pins
 * each entry to within tolerance of the target formula and fails when a
 * strategy/price change drifts a sector's RPU far enough that its facility
 * size stops being honest — at which point the author re-rounds it on purpose.
 */

import type { CorporationType } from "@/lib/constants/corporations";

/**
 * The daily nameplate revenue one facility should represent, in modern ₳.
 * Chosen so a single build is a real investment (cost ≈ 15x this at 2019
 * prices) without pricing small corps out of their first facility.
 */
export const FACILITY_TARGET_DAILY_REVENUE_ANCHOR = 25_000;

/** Units per facility, per sector type. Legibly rounded, never below 1. */
const FACILITY_SIZE_UNITS: Record<CorporationType, number> = {
  financial: 6,
  media: 80,
  manufacturing: 25,
  chemical_industries: 60,
  healthcare: 5,
  retail: 80,
  automobiles: 1,
  technology: 25,
  energy: 250,
  agriculture: 60,
  real_estate: 5,
  construction: 3,
  defense: 8,
  telecommunications: 12,
  entertainment: 50,
  logistics: 5,
  extraction: 250,
};

/** Capacity units in one facility of `sectorType`. Always a positive integer. */
export function plantSizeUnits(sectorType: CorporationType): number {
  return FACILITY_SIZE_UNITS[sectorType] ?? 1;
}

/**
 * Whole facilities represented by `units` of capacity, floored. A sector
 * holding less than one facility's worth still shows 1 when it has any
 * capacity at all — a player owns "a small plant", not "0 plants".
 */
export function facilitiesFromUnits(sectorType: CorporationType, units: number): number {
  if (!Number.isFinite(units) || units <= 0) return 0;
  return Math.max(1, Math.floor(units / plantSizeUnits(sectorType)));
}
