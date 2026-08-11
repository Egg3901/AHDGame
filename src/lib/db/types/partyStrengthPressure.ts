import type { CountryId } from "../../constants/countries";

/**
 * Per-geography PS pressure track. One row per `(countryId, partyId, stateId)`.
 *
 * Pressure escalates by `PRESSURE_LADDER_INCREMENT` each time the party
 * spends PS in that geography, and decays by `PRESSURE_DECAY_PER_TURN` per
 * turn (floored at `0`). Effective action cost is
 * `baseCost + min(value, PRESSURE_LADDER_MAX_COST - baseCost)`.
 *
 * National parties acting in a specific state read / write the same row as
 * the state-party would; per the plan's locked assumption, "spending in
 * Arizona should not raise the national PS cost of acting in California" —
 * i.e. pressure is per-geography, not per-party-scope-pair.
 *
 * Phase 3 introduces this collection. See plan §"Phase 3 — Tasks" 3.1 / 3.3.
 */
export interface PartyStrengthPressure {
  _id: string;
  countryId: CountryId;
  partyId: string;
  stateId: string;
  /**
   * Current pressure value. Floored at `0`; capped indirectly because the
   * effective per-action cost saturates at `PRESSURE_LADDER_MAX_COST`.
   */
  value: number;
  lastUpdatedTurn: number;
}
