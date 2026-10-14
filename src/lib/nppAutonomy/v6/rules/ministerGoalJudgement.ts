/**
 * Ministers judged on their goal (v6).
 *
 * Below v6 a head of government reshuffles a minister on raw shortfall: how far
 * the minister's agenda domains sit below target, scaled by the head's
 * reshuffle propensity. That blames a minister for where a domain stands, not
 * for what the minister did with it, so one who inherits a badly failing domain
 * and is turning it around looks exactly like one who is letting it slide.
 *
 * At v6, when the government holds standing goals (V5) on the minister's brief,
 * the head reads the goal record instead. Persisted goals are always open
 * attempts: a failed attempt is re-opened on the same domain with `strikes`
 * incremented and `openedTurn` set to the review that failed it, so a strike
 * plus the opening turn is the record of failure.
 *
 *   - progress: an attempt on the brief has gained at least the V5 progress
 *     margin since it opened (live attainment against `openingAttainment`). The
 *     minister is kept, whatever the raw shortfall says, including on a domain
 *     that failed before.
 *   - failure: an attempt on the brief carries a strike, the minister was in
 *     post when that strike was recorded, and the new attempt shows no progress
 *     yet. The minister is a reshuffle candidate, whatever the raw shortfall
 *     says. A minister appointed after the failure is not blamed for it.
 *   - otherwise (no goal on the brief, or a goal held without progress and
 *     without a strike on this minister's watch): the ordinary shortfall rule.
 *
 * Failure is checked before progress across the brief: a minister who let one
 * of their goals fail is not saved by drift on another.
 *
 * The verdict only decides whether the reshuffle threshold is met. The
 * tenure, cooldown and escalation guard (`evaluateReshuffleEligibility`) and
 * every cap still decide whether the head may act on it, so this changes who
 * is judged, never how often a government may reshuffle.
 *
 * Pure, deterministic, total.
 */

import { goalAttainment, type GoverningGoalRecord } from "../../v5/rules/governingGoals";

/** Attainment gain that counts as progress. Matches the V5 review's margin. */
export const GOAL_PROGRESS_MARGIN = 0.05;

export type MinisterGoalVerdict =
  /** A goal on the brief failed on this minister's watch and is not recovering. */
  | "goal-failed"
  /** A goal on the brief is progressing. */
  | "goal-progress"
  /** No goal evidence; use the shortfall rule. */
  | "shortfall";

export interface MinisterGoalJudgement {
  verdict: MinisterGoalVerdict;
  /** The goal that decided the verdict, when one did. */
  domain?: string;
}

/**
 * Judge one minister's brief against the government's standing goals.
 *
 * `appointedTurn` is the minister's seat stamp; null (legacy, unstamped) is
 * treated as in post throughout, matching the tenure guard's waiver.
 */
export function judgeMinisterOnGoals(params: {
  domains: ReadonlySet<string>;
  goals: readonly GoverningGoalRecord[];
  domainHealth: Record<string, number>;
  appointedTurn: number | null;
}): MinisterGoalJudgement {
  const { domains, goals, domainHealth, appointedTurn } = params;
  const onBrief = goals.filter((goal) => domains.has(goal.domain));
  if (onBrief.length === 0) return { verdict: "shortfall" };

  const progressed = (goal: GoverningGoalRecord): boolean => {
    const live = goalAttainment(goal, domainHealth, goal.domain) ?? goal.attainment;
    return live - goal.openingAttainment >= GOAL_PROGRESS_MARGIN;
  };

  const failed = onBrief.find(
    (goal) =>
      goal.strikes > 0 &&
      (appointedTurn === null || appointedTurn <= goal.openedTurn) &&
      !progressed(goal)
  );
  if (failed) return { verdict: "goal-failed", domain: failed.domain };

  const progressing = onBrief.find(progressed);
  if (progressing) return { verdict: "goal-progress", domain: progressing.domain };

  return { verdict: "shortfall" };
}

/**
 * Whether the reshuffle threshold is met for this minister. `shortfallMet` is
 * the below-v6 verdict (`shouldReshuffleMinister`); the goal verdict overrides
 * it only when the goal record says something.
 */
export function reshuffleThresholdMet(
  judgement: MinisterGoalJudgement,
  shortfallMet: boolean
): boolean {
  if (judgement.verdict === "goal-failed") return true;
  if (judgement.verdict === "goal-progress") return false;
  return shortfallMet;
}
