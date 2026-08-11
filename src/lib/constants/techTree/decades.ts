/**
 * Decade brackets for the sector tech trees.
 *
 * Each corporation sector tree is organised into six decade tiers. A tier
 * becomes researchable once the game world's `currentYear` reaches its
 * `startYear`; earlier decades than the world's starting decade are treated as
 * ungated baseline and never appear (per design: "only the current decade
 * onward is researchable"). Future decades stay locked until the clock arrives.
 *
 * `currentYear` is derived from the active reset preset's `startingYear`
 * (1979, 1991, 1999, 2007, 2019, …) plus elapsed game years — see
 * `src/lib/time/gameTime.ts`. The brackets below are intentionally aligned to
 * the canonical reset eras so a 1979-start world walks the whole tree while a
 * 2019-start world only ever sees the final two tiers.
 */

export interface TechDecade {
  /** Stable id — the bracket's start year as a string (e.g. "1979"). */
  id: string;
  /** Display label, e.g. "1979–1989". */
  label: string;
  /** First calendar year (inclusive) the tier is researchable. */
  startYear: number;
  /** Last calendar year (exclusive) the tier represents. */
  endYear: number;
}

export const TECH_DECADES: readonly TechDecade[] = [
  { id: "1940", label: "1940–1950", startYear: 1940, endYear: 1950 },
  { id: "1950", label: "1950–1960", startYear: 1950, endYear: 1960 },
  { id: "1960", label: "1960–1970", startYear: 1960, endYear: 1970 },
  { id: "1970", label: "1970–1979", startYear: 1970, endYear: 1979 },
  { id: "1979", label: "1979–1989", startYear: 1979, endYear: 1989 },
  { id: "1989", label: "1989–1999", startYear: 1989, endYear: 1999 },
  { id: "1999", label: "1999–2009", startYear: 1999, endYear: 2009 },
  { id: "2009", label: "2009–2019", startYear: 2009, endYear: 2019 },
  { id: "2019", label: "2019–2029", startYear: 2019, endYear: 2029 },
  { id: "2029", label: "2029–2039", startYear: 2029, endYear: 2039 },
] as const;

export type TechDecadeId = (typeof TECH_DECADES)[number]["id"];

/** Look up a decade bracket by id. */
export function getDecadeById(decadeId: string): TechDecade | undefined {
  return TECH_DECADES.find((d) => d.id === decadeId);
}

/**
 * The decade bracket a given calendar year falls into. Years before the first
 * bracket clamp to the earliest; years past the last clamp to the latest.
 */
export function getDecadeForYear(year: number): TechDecade {
  for (let i = TECH_DECADES.length - 1; i >= 0; i--) {
    if (year >= TECH_DECADES[i].startYear) return TECH_DECADES[i];
  }
  return TECH_DECADES[0];
}

/**
 * Decades that are researchable in a world at `currentYear`: the world's
 * current decade and every decade after it (future tiers are locked until the
 * clock reaches them but are still surfaced so players can see what's coming).
 * Earlier decades than the current one are excluded entirely.
 */
export function getResearchableDecades(currentYear: number): TechDecade[] {
  const current = getDecadeForYear(currentYear);
  const startIdx = TECH_DECADES.findIndex((d) => d.id === current.id);
  return TECH_DECADES.slice(startIdx);
}

/** True when a decade tier has been reached by the world clock (unlock-eligible). */
export function isDecadeReached(decadeId: string, currentYear: number): boolean {
  const decade = getDecadeById(decadeId);
  if (!decade) return false;
  return currentYear >= decade.startYear;
}
