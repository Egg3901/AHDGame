/**
 * NPP engine 6.1: candidate placement by strength.
 *
 * Below v6 a party's generic fill takes NPPs in load order and fills a
 * state's open primaries in `RACE_PRIORITY` order, so the first NPP loaded
 * runs for the lowest office (state senate) and whoever is left over runs for
 * governor. The nationwide executive slot goes to the lowest id.
 *
 * At v6 the same primaries are filled (coverage is decided exactly as before:
 * the first `pool size` unfilled primaries in priority order), but the
 * strongest NPPs are placed in the most senior of them. Strength is the NPP's
 * own standing, political influence plus favorability, so it never adds a
 * resource: it only decides who runs where.
 */

interface StrengthInputs {
  _id: { toString(): string };
  politicalInfluence?: number | null;
  favorability?: number | null;
}

const finite = (value: number | null | undefined): number =>
  Number.isFinite(value) ? (value as number) : 0;

export function nppCandidateStrength(npp: StrengthInputs): number {
  return finite(npp.politicalInfluence) + finite(npp.favorability);
}

/** Strongest first; ties broken by id so the pick is deterministic. */
export function compareStrongestFirst(a: StrengthInputs, b: StrengthInputs): number {
  const diff = nppCandidateStrength(b) - nppCandidateStrength(a);
  if (diff !== 0) return diff;
  const [ida, idb] = [a._id.toString(), b._id.toString()];
  return ida < idb ? -1 : ida > idb ? 1 : 0;
}

/**
 * The primaries a pool of `poolSize` NPPs fills, most senior first.
 *
 * `unfilledByPriority` is in `RACE_PRIORITY` order (lowest index first), as
 * the legacy pass walks it. The legacy pass fills the first `poolSize` of
 * them, so this keeps that set and only reorders it: a higher priority index
 * is a more senior office (governor is last in `RACE_PRIORITY`).
 */
export function placementOrder<T>(
  unfilledByPriority: readonly T[],
  poolSize: number,
  priorityOf: (primary: T) => number
): T[] {
  return unfilledByPriority
    .slice(0, Math.max(0, poolSize))
    .map((primary, index) => ({ primary, index }))
    .sort((a, b) => priorityOf(b.primary) - priorityOf(a.primary) || a.index - b.index)
    .map(({ primary }) => primary);
}

/**
 * NPP engine 6.12: placement by chance of winning (v6).
 *
 * 6.1 sends a party's strongest NPPs to its most senior races. Where the party
 * is weak across the region, the senior regional races are the ones it cannot
 * win, so that spent its best candidates on lost causes. A party whose
 * organization in the region is below `COMPETITIVE_ORG_RATIO` of the leading
 * party's places its strongest NPPs in its most local races instead, where a
 * weaker party can still win seats. The same primaries are filled either way.
 */
export const COMPETITIVE_ORG_RATIO = 0.75;

/** Whether a party can contest the region's senior races. True without data. */
export function partyCompetitiveInRegion(
  partyOrganization: number | undefined,
  leadingOrganization: number | undefined
): boolean {
  if (partyOrganization == null || leadingOrganization == null || !(leadingOrganization > 0)) {
    return true;
  }
  return partyOrganization >= COMPETITIVE_ORG_RATIO * leadingOrganization;
}
