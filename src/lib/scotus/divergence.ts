/**
 * Divergence algorithm (#3598, spec #3581, ahd-scotus-adr-majority-headcount-divergence).
 *
 * At case decision time, count seated justices (vacant seats excluded from the
 * denominator) on each side of the case's tagged axis (economic or social). If
 * the current majority's side matches the case's authored historical-majority
 * direction, the case affirms history (no-op). If it differs, the case
 * diverges. Majority is a straight headcount — NOT an average of lean scores,
 * so outlier justices can't drag a court-wide mean across the line the way a
 * real 9-member panel never would.
 *
 * Pure function, no DB dependency — unit-tested in isolation per #3598's
 * testing section.
 *
 * RACE/EQUALITY CASES ARE DELIBERATELY EXEMPT FROM THIS ALGORITHM
 * -----------------------------------------------------------------
 * This is a settled product decision, not an inconsistency to be tidied up:
 * Brown v. Board and the other racial-equal-protection cases in the catalogue
 * (Loving v. Virginia, Griggs v. Duke Power, Bakke v. Regents, Shelby County
 * v. Holder — see `historicalOutcomeLocked` on `DocketCase` and the file
 * header of `src/lib/scotus/presetData/1953.ts`) always resolve to their real
 * historical outcome, regardless of the sitting Court's composition. There is
 * no "what if segregation were upheld" branch, and none should be added —
 * composition-driven headcount divergence for these specific cases is out of
 * scope, permanently, not merely unimplemented. The demographic CONSEQUENCES
 * of these rulings (Southern white defection, Black voter consolidation and
 * turnout gains) are still modeled in full via `src/lib/demographics/
 * eraCheckpoints.ts` — what is fixed is the ruling, not its downstream
 * politics.
 *
 * Every OTHER case in the catalogue — the reapportionment trio (Baker v.
 * Carr/Reynolds v. Sims/Wesberry v. Sanders), Engel v. Vitale, Griswold v.
 * Connecticut, Watkins v. United States, Mapp v. Ohio, Miranda v. Arizona, NYT
 * v. Sullivan, and the rest — is genuine alternate-history territory and
 * continues to use the composition-driven headcount below unmodified.
 */

export type CaseAxis = "economic" | "social";
export type MajorityDirection = 1 | -1;
export type CaseOutcome = "affirmed" | "diverged";

export interface SeatedJusticeLean {
  economicLean: number;
  socialLean: number;
}

export interface CaseDivergenceResult {
  /** Count of seated (non-vacant) justices considered — vacant seats never appear in this list at all. */
  seatedCount: number;
  /** Justices whose lean on the tagged axis is > 0. */
  positiveCount: number;
  /** Justices whose lean on the tagged axis is < 0. */
  negativeCount: number;
  /** Justices whose lean on the tagged axis is exactly 0 — count toward neither side of the headcount. */
  neutralCount: number;
  /**
   * The sitting majority's side on the tagged axis: 1 (positive majority), -1
   * (negative majority), or 0 when positive/negative counts are tied (or when
   * no justices are seated at all). A court that fails to produce a clear
   * majority — tied seated justices, or an empty bench — cannot hand down a
   * ruling at all, so it always affirms (upholds the existing/lower result,
   * no history divergence) — see the outcome computation.
   */
  majoritySide: MajorityDirection | 0;
  outcome: CaseOutcome;
}

export interface DecideCaseOutcomeOptions {
  /**
   * When true, `outcome` is forced to "affirmed" regardless of the computed
   * `majoritySide` — the case always resolves to its real historical result.
   * Reserved for race/equal-protection cases (see the module doc comment
   * above); every other case must omit this. The seat headcount
   * (`positiveCount`/`negativeCount`/`majoritySide`) is still computed and
   * returned honestly even when locked — only `outcome` is pinned — so the
   * sitting Court's actual composition remains visible for flavor/audit
   * purposes without ever driving a different legal result.
   */
  historicalOutcomeLocked?: boolean;
}

/**
 * Decide whether a Docket case affirms or diverges from history, given the
 * currently seated justices' leans on the case's tagged axis.
 *
 * `seatedJustices` must already exclude vacant seats — this function has no
 * concept of a seat, only of who is currently seated.
 */
export function decideCaseOutcome(
  seatedJustices: SeatedJusticeLean[],
  axis: CaseAxis,
  historicalMajorityDirection: MajorityDirection,
  options?: DecideCaseOutcomeOptions
): CaseDivergenceResult {
  let positiveCount = 0;
  let negativeCount = 0;
  let neutralCount = 0;

  for (const justice of seatedJustices) {
    const lean = axis === "economic" ? justice.economicLean : justice.socialLean;
    if (lean > 0) positiveCount++;
    else if (lean < 0) negativeCount++;
    else neutralCount++;
  }

  const majoritySide: MajorityDirection | 0 =
    positiveCount > negativeCount ? 1 : negativeCount > positiveCount ? -1 : 0;

  // A court with no clear majority cannot hand down a ruling (ticket 1187): a
  // tied headcount (e.g. 4-4) has to affirm — uphold the existing/lower
  // result — the same as an empty bench, which also cannot overrule history.
  // Without this guard, `majoritySide` 0 never equals the authored ±1
  // direction, so a tied court would fire as a "divergence" no player or NPP
  // actually caused.
  const outcome: CaseOutcome =
    options?.historicalOutcomeLocked || majoritySide === 0
      ? "affirmed"
      : majoritySide === historicalMajorityDirection
        ? "affirmed"
        : "diverged";

  return {
    seatedCount: seatedJustices.length,
    positiveCount,
    negativeCount,
    neutralCount,
    majoritySide,
    outcome,
  };
}
