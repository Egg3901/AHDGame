/**
 * NPP engine 6.9: career ladders (v6).
 *
 * Below v6 every NPP incumbent re-files for the seat it holds, cycle after
 * cycle, however strong and ambitious it is; senior offices are filled only
 * from NPPs without a seat. At v6 an ambitious, strong incumbent in a single
 * seat steps up instead: it runs for an open, more senior race in its home
 * region (no candidate and no defending incumbent from its party), and its
 * own seat goes back into ordinary fill.
 */
import { nppCandidateStrength } from "./candidatePlacement";

/** Ambition an incumbent needs before it gives up a safe seat to climb. */
export const CAREER_AMBITION_MIN = 70;
/** Strength (influence plus favorability, out of 200) it needs. */
export const CAREER_STRENGTH_MIN = 100;

export function isCareerClimber(npp: {
  _id: { toString(): string };
  personality?: { ambition?: number } | null;
  politicalInfluence?: number | null;
  favorability?: number | null;
}): boolean {
  return (
    (npp.personality?.ambition ?? 0) >= CAREER_AMBITION_MIN &&
    nppCandidateStrength(npp) >= CAREER_STRENGTH_MIN
  );
}

/**
 * The senior primary to climb to, or null. `options` are open primaries in the
 * NPP's home region already filtered to ones its party has not claimed;
 * seniority is the race-priority index (higher is more senior). The most
 * senior option wins, ties broken by id.
 */
export function pickCareerStep<T extends { _id: { toString(): string } }>(
  currentSeniority: number,
  options: readonly T[],
  seniorityOf: (primary: T) => number
): T | null {
  let best: T | null = null;
  for (const option of options) {
    const seniority = seniorityOf(option);
    if (seniority <= currentSeniority) continue;
    if (
      !best ||
      seniority > seniorityOf(best) ||
      (seniority === seniorityOf(best) && option._id.toString() < best._id.toString())
    ) {
      best = option;
    }
  }
  return best;
}
