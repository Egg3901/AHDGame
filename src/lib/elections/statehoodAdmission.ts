/**
 * Statehood admission — era-windowed pressure, not a script.
 *
 * Statehood in this codebase is defined by presence in the active apportionment
 * map (see `initializeOfficials`: "the apportionment map is what defines
 * statehood"). That map is a frozen per-preset constant, so a territory absent
 * from it — Alaska and Hawaii under `1953-default` — was seeded but seatless
 * and could never become a state. `runCensus` can reapportion, but it only ever
 * redistributes among states that already hold seats; nothing could ADMIT.
 *
 * This module supplies the missing transition, under the program's design law:
 * **gravity, not rails**. Admission is not scripted to fire in 1959. Each
 * territory carries a window and a cumulative admission curve whose median sits
 * on the historical year, so a world left alone will usually admit Alaska and
 * Hawaii around 1959 — and sometimes in 1956, sometimes in 1963. It is a pull,
 * not a timetable.
 *
 * The curve is expressed as a CDF rather than a per-year hazard, because the
 * property worth guaranteeing is "the median lands on the historical year", and
 * a CDF states that directly instead of leaving it to emerge from tuning. The
 * per-year hazard is derived from it.
 */

import { hashToUint32 } from "@/lib/events/substrate/rng";
import { getHouseSeats, isUsElectoralState } from "@/lib/constants/states";

/** A territory that can be admitted as a state, and when that pull applies. */
export interface TerritoryAdmission {
  /** State id, matching the seed `states` collection (e.g. "AK"). */
  stateId: string;
  /** Display name for the admission news post. */
  name: string;
  /**
   * The real admission year. By construction this is the MEDIAN of the
   * admission curve — half of untouched worlds admit by the end of this year —
   * not the year it fires.
   */
  historicalYear: number;
  /** No admission pressure exists before this year. */
  windowStartYear: number;
  /** Admission is certain by the end of this year if it has not happened. */
  windowEndYear: number;
}

/**
 * Alaska and Hawaii both entered in 1959, after statehood movements that ran
 * through the 1950s. The shared window opens in 1950 (the Alaska Statehood
 * Committee era) and closes in 1970, past which a world that somehow still
 * holds them as territories admits them outright.
 *
 * Earlier presets need no entries: `1979-default` and later already carry both
 * in their apportionment maps, and this table is only consulted for territories
 * absent from the active map.
 */
export const TERRITORY_ADMISSIONS: TerritoryAdmission[] = [
  {
    stateId: "AK",
    name: "Alaska",
    historicalYear: 1959,
    windowStartYear: 1950,
    windowEndYear: 1970,
  },
  {
    stateId: "HI",
    name: "Hawaii",
    historicalYear: 1959,
    windowStartYear: 1950,
    windowEndYear: 1970,
  },
];

/**
 * Cumulative probability of having been admitted by the END of the historical
 * year. 0.5 is what makes that year the median rather than a rail.
 */
export const ADMISSION_CDF_AT_HISTORICAL_YEAR = 0.5;

/** House seats a newly admitted state receives — the constitutional floor. */
export const INITIAL_HOUSE_SEATS_ON_ADMISSION = 1;

/**
 * Curvature of the post-historical ramp (see {@link admissionCdf}). Below 1 it
 * climbs fast then flattens, so a world that misses the historical moment
 * resolves soon after instead of drifting to the end of the window.
 *
 * Tuned to 0.7 rather than the obvious 0.5: a square root puts so much mass in
 * the first year after the anchor that the year AFTER the historical one became
 * the single most likely admission year, which quietly moved the centre of
 * gravity off the history. `statehoodAdmission.test.ts` pins the historical year
 * as the modal year, so this constant cannot drift back.
 */
export const POST_WINDOW_RAMP_EXPONENT = 0.7;

/**
 * Cumulative probability that `t` has been admitted by the end of `year`.
 *
 * Pinned to three fixed points — 0 at the year before the window opens,
 * {@link ADMISSION_CDF_AT_HISTORICAL_YEAR} at the historical year, and 1 at the
 * window's end — with a shaped ramp between them.
 *
 * The ramps are curved rather than straight, and the curvature is the history:
 *
 * - **Before** the historical year the ramp is quadratic, so pressure builds.
 *   A straight line would make admission in 1950 exactly as likely as in 1958,
 *   which misstates a statehood movement that gathered force over a decade.
 * - **After** it the ramp is {@link POST_WINDOW_RAMP_EXPONENT}, below 1, so it
 *   climbs fast and then flattens. A world that misses the historical moment
 *   resolves soon after rather than drifting to the end of the window.
 *
 * Both shapes hit `progress = 1` at their anchor, so the median stays exactly on
 * the historical year regardless of curvature — the curve controls spread only.
 */
export function admissionCdf(t: TerritoryAdmission, year: number): number {
  if (year < t.windowStartYear) return 0;
  if (year >= t.windowEndYear) return 1;

  // The window opens at windowStartYear, so the last year with zero
  // probability is the one before it.
  const zeroYear = t.windowStartYear - 1;
  if (year <= t.historicalYear) {
    const span = t.historicalYear - zeroYear;
    if (span <= 0) return ADMISSION_CDF_AT_HISTORICAL_YEAR;
    const progress = (year - zeroYear) / span;
    return ADMISSION_CDF_AT_HISTORICAL_YEAR * progress * progress;
  }
  const span = t.windowEndYear - t.historicalYear;
  if (span <= 0) return 1;
  const progress = (year - t.historicalYear) / span;
  return (
    ADMISSION_CDF_AT_HISTORICAL_YEAR +
    (1 - ADMISSION_CDF_AT_HISTORICAL_YEAR) * Math.pow(progress, POST_WINDOW_RAMP_EXPONENT)
  );
}

/**
 * Probability that `t` is admitted DURING `year`, given it was not admitted
 * before — the per-year hazard implied by {@link admissionCdf}.
 *
 * `(F(y) - F(y-1)) / (1 - F(y-1))`: the year's share of the remaining
 * probability mass. Rolling this once a year reproduces the CDF exactly, which
 * is what keeps the median honest.
 */
export function admissionHazard(t: TerritoryAdmission, year: number): number {
  const prior = admissionCdf(t, year - 1);
  if (prior >= 1) return 0;
  const current = admissionCdf(t, year);
  if (current <= prior) return 0;
  return (current - prior) / (1 - prior);
}

/**
 * Deterministic [0, 1) draw for one territory in one year.
 *
 * Keyed on the world's iteration so different worlds diverge, and on the year
 * rather than the turn so re-evaluating a year is idempotent — a retried or
 * replayed turn cannot roll twice for the same year and double the real hazard.
 * Turn paths must never use `Math.random()`.
 */
export function admissionRoll(stateId: string, year: number, iteration: string): number {
  return hashToUint32(`statehood:${iteration}:${stateId}:${year}`) / 0x1_0000_0000;
}

/** A territory that crossed into statehood this year. */
export interface AdmissionDecision {
  stateId: string;
  name: string;
  year: number;
  /** The hazard it cleared, for the turn log. */
  hazard: number;
}

/**
 * Decide which of `candidates` are admitted during `year`.
 *
 * `candidates` should already exclude territories that are states under the
 * active apportionment map and those admitted in an earlier year — this
 * function does not know the world, only the roll.
 */
export function decideAdmissions(
  candidates: TerritoryAdmission[],
  year: number,
  iteration: string
): AdmissionDecision[] {
  const admitted: AdmissionDecision[] = [];
  for (const t of candidates) {
    const hazard = admissionHazard(t, year);
    if (hazard <= 0) continue;
    if (admissionRoll(t.stateId, year, iteration) < hazard) {
      admitted.push({ stateId: t.stateId, name: t.name, year, hazard });
    }
  }
  return admitted;
}

/** The shape every statehood gate needs from a state document. */
export interface AdmissionBearingState {
  _id: string;
  admittedYear?: number;
}

/**
 * State ids admitted to the Union at or before `asOfYear`.
 *
 * This is the single reader of `admittedYear`, and every statehood gate goes
 * through it: apportionment, seat creation, bootstrap officials, and the
 * perpetual-election spawner. They previously all tested
 * `getHouseSeats(preset)[id] != null` directly, which can never become true
 * mid-game — so a gate that forgets this reader silently keeps an admitted
 * state a territory in its own corner of the game.
 *
 * The year check matters: an admission must not take effect before its year.
 */
export function admittedStateIdsAsOf(
  states: readonly AdmissionBearingState[],
  asOfYear: number
): string[] {
  return states
    .filter((s) => typeof s.admittedYear === "number" && s.admittedYear <= asOfYear)
    .map((s) => s._id);
}

/**
 * True when a US region hosts full state politics for this era: House seats under
 * the active apportionment map, or mid-game admission via `admittedYear`.
 *
 * DC fails `isUsElectoralState` and stays out. Alaska/Hawaii fail under
 * `1953-default` until admitted. Same gate `seedSeats` / perpetual elections /
 * `initializeOfficials` already use — keep them in step via this helper.
 */
export function isUsPoliticalState(
  stateId: string,
  preset: string | undefined,
  admittedIds: ReadonlySet<string> = new Set()
): boolean {
  if (!isUsElectoralState(stateId)) return false;
  if (getHouseSeats(preset)[stateId] != null) return true;
  return admittedIds.has(stateId);
}

/**
 * True when a US region can be a player's political home.
 *
 * Alaska and Hawaii begin as territories in the 1953 era, but territorial
 * residents may organize parties and elect a territorial governor. Full state
 * politics remains behind {@link isUsPoliticalState}: territories do not gain
 * House, Senate, or state-legislative seats until admission.
 */
export function isUsResidentPoliticalRegion(
  stateId: string,
  preset: string | undefined,
  admittedIds: ReadonlySet<string> = new Set()
): boolean {
  return (
    isUsPoliticalState(stateId, preset, admittedIds) ||
    TERRITORY_ADMISSIONS.some((territory) => territory.stateId === stateId)
  );
}

/** Headline for the admission news post. */
export function buildAdmissionContent(decisions: AdmissionDecision[]): string {
  if (decisions.length === 0) return "";
  const names = decisions.map((d) => d.name);
  const year = decisions[0].year;
  if (names.length === 1) {
    return `${names[0]} is admitted to the Union in ${year}, taking its seats in the House and Senate. House apportionment will be recalculated at the next census.`;
  }
  const list = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${list} are admitted to the Union in ${year}, taking their seats in the House and Senate. House apportionment will be recalculated at the next census.`;
}
