/**
 * The flashpoints themselves — authored historical anchors, and the markers for
 * crises that arise from world conditions instead of the calendar.
 *
 * Client-safe: no db imports. The turn phase owns opening and closing.
 */

export interface AuthoredCrisis {
  /** Stable id, also the crisis document's `kind`. */
  kind: string;
  /** Preferred target. Retargeted when absent from the world or already locked. */
  targetEntityId: string;
  title: string;
  /**
   * Headline naming the KIND of crisis, never the nation — an authored crisis
   * retargets when its country is missing, and the copy has to survive that.
   */
  headline: string;
  /** Inclusive era bounds, matching the world-event scheduler's convention. */
  minYear: number;
  maxYear: number;
}

/**
 * Egypt and Cuba are deliberately included though neither is an implemented
 * country: an authored crisis whose target is absent retargets to the most
 * contested nation rather than fizzling, so these still fire as generic
 * flashpoints and become the real thing if those countries ever land.
 */
export const AUTHORED_CRISES: readonly AuthoredCrisis[] = [
  {
    kind: "crisis.hungarianRising",
    targetEntityId: "HU",
    title: "A rising against Moscow",
    headline: "Crowds have taken the streets and the government has lost control of them.",
    minYear: 1956,
    maxYear: 1958,
  },
  {
    kind: "crisis.suezIntervention",
    targetEntityId: "EG",
    title: "A canal seized",
    headline: "A waterway the old powers thought theirs has been nationalised overnight.",
    minYear: 1956,
    maxYear: 1958,
  },
  {
    kind: "crisis.berlinFlashpoint",
    targetEntityId: "DD",
    title: "A city divided",
    headline: "The exodus through the open sector has become impossible to ignore.",
    minYear: 1958,
    maxYear: 1963,
  },
  {
    kind: "crisis.missileStandoff",
    targetEntityId: "CU",
    title: "Missiles at close range",
    headline: "Launchers have appeared within striking distance of a superpower.",
    minYear: 1962,
    maxYear: 1964,
  },
  {
    kind: "crisis.pragueSpring",
    targetEntityId: "CS",
    title: "Reform under the tanks",
    headline: "A liberalising government is testing how much its patron will tolerate.",
    minYear: 1968,
    maxYear: 1970,
  },
];

/** Crises that arise from the state of the world rather than the calendar. */
export const EMERGENT_CRISES = {
  tugOfWar: {
    kind: "emergent.tugOfWar",
    title: "A country pulled two ways",
    headline: "Two blocs are both deeply invested here, and neither is giving ground.",
  },
  defection: {
    kind: "emergent.defection",
    title: "An ally slipping away",
    headline: "A bloc member is drifting out of its alliance, and there is still time to act.",
  },
} as const;

/** Authored crises whose era window contains this year. */
export function authoredCrisesForYear(year: number): AuthoredCrisis[] {
  return AUTHORED_CRISES.filter((c) => year >= c.minYear && year <= c.maxYear);
}
