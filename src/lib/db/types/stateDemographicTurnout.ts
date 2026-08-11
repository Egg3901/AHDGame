import type { CountryId } from "../../constants/countries";

/**
 * Turnout modifiers keyed by demographic category → group ID.
 *
 * Values range from -20 to +20, representing percentage point adjustments
 * to baseline turnout rates.
 *
 * Modified through:
 * - Party GOTV budget spending (passive, aligned demographics only)
 * - Player canvassing actions (active campaigns required)
 *
 * Modifiers decay at 2% per turn and face diminishing returns as they
 * approach their caps.
 *
 * Shape: Record<categoryId, Record<groupId, modifier>>
 *
 * For US (voterGroups-only):
 *   { voterGroups: { college_liberals: 5, evangelicals: -3, ... } }
 *
 * For UK (voterGroups-only):
 *   { voterGroups: { urban_progressives: 4, rural_traditionalists: -2, ... } }
 *
 * Legacy US documents (pre-migration) used a nested struct:
 *   { race: { white, black, hispanic, asian, other }, age: { ... }, ... }
 * These are automatically handled by the turnout decay and application code.
 */
export type DemographicModifiers = Record<string, Record<string, number>>;

/**
 * State/region-specific demographic turnout modifiers.
 *
 * One document exists per region (US: 51 state/DC docs; UK: 650 constituency docs).
 */
export interface StateDemographicTurnout {
  /** Region ID (e.g. "PA", "CA" for US; "E14000530" for UK constituency) */
  _id: string;
  countryId: CountryId;
  /** Turnout modifiers by demographic category and group */
  modifiers: DemographicModifiers;
  /** Timestamp of last decay application (decay runs each turn) */
  lastDecayApplied: Date;
  /** Timestamp of last modifier update (GOTV or canvassing) */
  lastUpdated: Date;
}
