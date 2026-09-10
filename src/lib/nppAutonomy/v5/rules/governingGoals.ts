/**
 * GOVERNING GOALS — the V5 increment.
 *
 * V1 gave a government a multi-turn agenda; the problem it left is that the
 * agenda is recomputed wholesale every cycle. A government could pursue a domain
 * for a week, get nowhere, and have the next recompute quietly replace it with
 * something else — no verdict, no memory, no consequence. From the outside that
 * reads as a government with no follow-through, because that is exactly what it
 * was.
 *
 * V5 keeps a bounded set of **goal records** across recomputes. Each record is
 * opened from an agenda item, graded at every review against the same domain
 * health the accountability nudge already reads, and closed with a verdict:
 *
 *   achieved — the domain reached its target. Bank it and shift attention.
 *   revised  — real progress but not done. Re-open on the same domain.
 *   failed   — the hold expired with no progress. Deprioritise the domain, and
 *              remember how many times in a row that has now happened.
 *   active   — inside its hold window. Held, whatever the fresh scan says.
 *
 * Two properties are load-bearing and both are enforced here rather than by
 * convention:
 *
 *   - **Bounded.** At most `GOAL_SLOT_CAP` records exist per government, ever.
 *     There is no history list, no per-turn append, nothing that grows with
 *     playtime. A closed goal occupies its slot until a new goal takes it.
 *   - **No new powers.** These records are *intent*. Nothing here writes game
 *     state, spends anything, or bypasses a check. The verdicts re-weight the
 *     next agenda and pin standing commitments onto it; the agenda is then
 *     executed by exactly the ministerial / sponsorship / action pipelines v4
 *     already used, with their existing validation, costs and cooldowns.
 *
 * Pure, deterministic, total. Time arrives as `currentTurn`.
 */

import type { AgendaDirection, GoverningAgendaItem } from "../../governingAgenda";
import { GOVERNING_ARCHETYPE_CLAMP } from "../../governingArchetype";
import { GOAL_SLOT_CAP, type NppBehaviorPolicy } from "@/lib/singleplayerDifficulty/rules/behavior";

export { GOAL_SLOT_CAP };

export type GoverningGoalStatus = "active" | "achieved" | "failed" | "revised";

export interface GoverningGoalRecord {
  domain: string;
  /** "hold" never opens a goal, so a record's direction is always actionable. */
  direction: Exclude<AgendaDirection, "hold">;
  target: number;
  /** Priority carried from the agenda item that opened or renewed this goal. */
  priority: number;
  status: GoverningGoalStatus;
  /** Turn the current attempt began. Reset when a goal is revised and re-opened. */
  openedTurn: number;
  /** Turn of the most recent review. */
  reviewedTurn: number;
  /** Attainment in [0,1] when the goal was opened — the baseline progress is measured against. */
  openingAttainment: number;
  /** Attainment in [0,1] at the last review. */
  attainment: number;
  /**
   * Consecutive failed attempts on this domain. Survives re-opening, resets on
   * achievement. This is the whole memory: one small integer, not a log.
   */
  strikes: number;
  /** Opened by an active crisis. Crisis goals are never held out by an older commitment. */
  crisis?: boolean;
}

/** Persisted shape on `governmentFormation.governingGoals`. */
export interface GoverningGoalState {
  goals: GoverningGoalRecord[];
  /** Turn the set was last reconciled. */
  updatedTurn: number;
}

/** Attainment at/above which a goal counts as achieved. Attainment is clamped to 1. */
const ACHIEVED_ATTAINMENT = 1;

/** Minimum attainment gain over the hold window that counts as progress (→ revised, not failed). */
const PROGRESS_EPSILON = 0.05;

/** Feedback multipliers applied to the next agenda's per-domain mass. All bounded. */
const FEEDBACK_ACHIEVED = 0.85;
const FEEDBACK_REVISED = 1.1;
const FEEDBACK_ACTIVE = 1.05;
const FEEDBACK_FAIL_STEP = 0.2;
const FEEDBACK_FLOOR = 0.5;
const FEEDBACK_CEILING = 1.15;

/**
 * Attainment of a goal against current domain health, in [0,1].
 *
 * Identical in shape to `computeGovernmentPerformance`'s per-item math on
 * purpose: a goal must be graded by the same yardstick the government is already
 * judged by at the ballot box, or the two loops disagree about whether the
 * government did its job. Unmeasurable health returns `null` — an ungraded goal
 * is held, never failed, because the government cannot be blamed for a metric
 * the world does not report.
 */
export function goalAttainment(
  goal: Pick<GoverningGoalRecord, "direction" | "target">,
  domainHealth: Record<string, number>,
  domain: string
): number | null {
  if (goal.target <= 0) return null;
  const health = domainHealth[domain];
  if (typeof health !== "number" || !Number.isFinite(health)) return null;
  const raw =
    goal.direction === "raise"
      ? health / goal.target
      : health > 0
        ? goal.target / health
        : ACHIEVED_ATTAINMENT;
  return Math.max(0, Math.min(1, raw));
}

export interface GoalReview {
  goals: GoverningGoalRecord[];
  /** Domain → bounded mass multiplier for the next agenda compute. */
  feedback: Record<string, number>;
  /** Counts by verdict this review, for logging and sim metrics. */
  verdicts: Record<GoverningGoalStatus, number>;
}

/**
 * Grade every standing goal. Pure: returns the reviewed records, never mutates.
 *
 * Runs BEFORE the next agenda is computed, so the verdicts can re-weight it.
 * Records already in a terminal state are re-graded as terminal (idempotent) —
 * a retried or replayed cycle cannot double-count a failure into extra strikes.
 */
export function reviewGoverningGoals(params: {
  goals: readonly GoverningGoalRecord[];
  domainHealth: Record<string, number>;
  policy: NppBehaviorPolicy;
  currentTurn: number;
}): GoalReview {
  const { goals, domainHealth, policy, currentTurn } = params;
  const reviewed: GoverningGoalRecord[] = [];
  const verdicts: Record<GoverningGoalStatus, number> = {
    active: 0,
    achieved: 0,
    failed: 0,
    revised: 0,
  };

  for (const goal of goals) {
    if (goal.status !== "active") {
      // Terminal already: carry it unchanged so a retry cannot re-close it.
      reviewed.push(goal);
      verdicts[goal.status]++;
      continue;
    }

    const attainment = goalAttainment(goal, domainHealth, goal.domain);
    if (attainment === null) {
      reviewed.push({ ...goal, reviewedTurn: currentTurn });
      verdicts.active++;
      continue;
    }

    const held = currentTurn - goal.openedTurn;
    if (attainment >= ACHIEVED_ATTAINMENT) {
      reviewed.push({
        ...goal,
        status: "achieved",
        attainment,
        reviewedTurn: currentTurn,
        strikes: 0,
      });
      verdicts.achieved++;
      continue;
    }

    if (held < policy.goalHoldTurns) {
      // Inside the hold window: the government stays on it. This is the
      // anti-oscillation rule — a goal is not abandoned because a fresh scan
      // ranked something else higher this cycle.
      reviewed.push({ ...goal, attainment, reviewedTurn: currentTurn });
      verdicts.active++;
      continue;
    }

    const progressed = attainment - goal.openingAttainment >= PROGRESS_EPSILON;
    if (progressed) {
      // Working, just not finished. Re-open on the same domain with a fresh
      // hold and a new baseline; strikes are untouched because this is not a
      // failure.
      reviewed.push({
        ...goal,
        status: "revised",
        attainment,
        reviewedTurn: currentTurn,
      });
      verdicts.revised++;
      continue;
    }

    reviewed.push({
      ...goal,
      status: "failed",
      attainment,
      reviewedTurn: currentTurn,
      strikes: goal.strikes + 1,
    });
    verdicts.failed++;
  }

  return { goals: reviewed, feedback: goalFeedback(reviewed), verdicts };
}

/**
 * Domain → bounded multiplier for the next agenda's accumulated mass.
 *
 * The accountability loop already turns attainment into favorability. This turns
 * it into *attention*: a domain the government keeps failing loses pull cycle
 * after cycle (floored, so it can always come back when conditions worsen
 * enough), a domain showing progress gains a little, and a won domain eases off.
 * Crisis mass is added to the agenda after feedback is applied, so an emergency
 * is never damped by an old failure.
 */
export function goalFeedback(goals: readonly GoverningGoalRecord[]): Record<string, number> {
  const feedback: Record<string, number> = {};
  for (const goal of goals) {
    let weight: number;
    switch (goal.status) {
      case "achieved":
        weight = FEEDBACK_ACHIEVED;
        break;
      case "revised":
        weight = FEEDBACK_REVISED;
        break;
      case "failed":
        weight = Math.max(FEEDBACK_FLOOR, 1 - FEEDBACK_FAIL_STEP * goal.strikes);
        break;
      default:
        weight = FEEDBACK_ACTIVE;
    }
    const bounded = Math.max(FEEDBACK_FLOOR, Math.min(FEEDBACK_CEILING, weight));
    // Worst multiplier wins if a domain somehow appears twice: never let a
    // duplicate slot turn a penalty into a bonus.
    feedback[goal.domain] =
      goal.domain in feedback ? Math.min(feedback[goal.domain], bounded) : bounded;
  }
  return feedback;
}

export interface GoalCommitment {
  goals: GoverningGoalRecord[];
  /** The agenda the government actually governs by: fresh scan plus held commitments. */
  agenda: GoverningAgendaItem[];
}

/**
 * Turn reviewed records plus a freshly computed agenda into the committed goal
 * set and the agenda the government will actually govern by.
 *
 * Slot rules, in order:
 *   1. Crisis items always get a slot. An emergency outranks any standing
 *      commitment; the country is on fire.
 *   2. Goals still `active` (inside their hold) keep their slots.
 *   3. `revised` goals re-open in place with a fresh hold and baseline.
 *   4. Remaining slots fill from the fresh agenda, highest priority first.
 *   5. Anything left over (achieved / failed / evicted) is dropped — the verdict
 *      has already been recorded in `feedback`, and keeping it would grow
 *      unbounded.
 *
 * The returned agenda leads with the committed domains so every downstream
 * consumer (ministerial orders, bill sponsorship, fiscal stance) reads the same
 * commitments without any of them needing to know goals exist. It stays capped
 * by `GOVERNING_ARCHETYPE_CLAMP.maxAgendaBreadth`, so V5 can never widen a
 * government's attention past the bound V1 already set.
 */
export function commitGoverningGoals(params: {
  reviewed: readonly GoverningGoalRecord[];
  agenda: readonly GoverningAgendaItem[];
  domainHealth: Record<string, number>;
  policy: NppBehaviorPolicy;
  currentTurn: number;
}): GoalCommitment {
  const { reviewed, agenda, domainHealth, policy, currentTurn } = params;
  const slots = Math.max(1, Math.min(GOAL_SLOT_CAP, policy.goalSlots));

  const actionable = agenda.filter(
    (item): item is GoverningAgendaItem & { direction: Exclude<AgendaDirection, "hold"> } =>
      item.direction !== "hold"
  );
  const agendaByDomain = new Map<string, (typeof actionable)[number]>();
  for (const item of actionable)
    if (!agendaByDomain.has(item.domain)) agendaByDomain.set(item.domain, item);

  const goals: GoverningGoalRecord[] = [];
  const taken = new Set<string>();

  const open = (
    item: (typeof actionable)[number],
    previous?: GoverningGoalRecord
  ): GoverningGoalRecord => ({
    domain: item.domain,
    direction: item.direction,
    target: item.target,
    priority: item.priority,
    status: "active",
    openedTurn: currentTurn,
    reviewedTurn: currentTurn,
    openingAttainment:
      goalAttainment(
        { direction: item.direction, target: item.target },
        domainHealth,
        item.domain
      ) ?? 0,
    attainment:
      goalAttainment(
        { direction: item.direction, target: item.target },
        domainHealth,
        item.domain
      ) ?? 0,
    strikes: previous?.strikes ?? 0,
    ...(item.crisis ? { crisis: true } : {}),
  });

  // 1. Crisis items first.
  for (const item of actionable) {
    if (goals.length >= slots) break;
    if (!item.crisis || taken.has(item.domain)) continue;
    const previous = reviewed.find((goal) => goal.domain === item.domain);
    goals.push(open(item, previous));
    taken.add(item.domain);
  }

  // 2. Held commitments, then 3. revised goals re-opened in place.
  for (const goal of reviewed) {
    if (goals.length >= slots) break;
    if (taken.has(goal.domain)) continue;
    if (goal.status === "active") {
      // Refresh target/priority from the fresh agenda when it still lists the
      // domain, so a held goal tracks a moved target instead of chasing a stale one.
      const fresh = agendaByDomain.get(goal.domain);
      goals.push(
        fresh && fresh.direction === goal.direction
          ? { ...goal, target: fresh.target, priority: fresh.priority }
          : goal
      );
      taken.add(goal.domain);
      continue;
    }
    if (goal.status === "revised") {
      const fresh = agendaByDomain.get(goal.domain);
      goals.push(
        open(
          fresh && fresh.direction === goal.direction
            ? fresh
            : {
                domain: goal.domain,
                direction: goal.direction,
                target: goal.target,
                priority: goal.priority,
              },
          goal
        )
      );
      taken.add(goal.domain);
    }
  }

  // 4. Fill the remainder from the fresh agenda.
  for (const item of actionable) {
    if (goals.length >= slots) break;
    if (taken.has(item.domain)) continue;
    const previous = reviewed.find((goal) => goal.domain === item.domain);
    goals.push(open(item, previous));
    taken.add(item.domain);
  }

  return { goals, agenda: pinCommitments(agenda, goals) };
}

/**
 * Lead the agenda with the committed goal domains, keeping every other item in
 * its computed order behind them, and cap the result.
 *
 * A committed domain the fresh scan dropped is re-inserted from its goal record
 * — that re-insertion IS the persistence: without it, "the goal survives the
 * recompute" would be a claim the executing code never sees.
 */
function pinCommitments(
  agenda: readonly GoverningAgendaItem[],
  goals: readonly GoverningGoalRecord[]
): GoverningAgendaItem[] {
  if (goals.length === 0) return [...agenda];
  const byDomain = new Map<string, GoverningAgendaItem>();
  for (const item of agenda) if (!byDomain.has(item.domain)) byDomain.set(item.domain, item);

  const out: GoverningAgendaItem[] = [];
  const seen = new Set<string>();
  for (const goal of goals) {
    const item = byDomain.get(goal.domain);
    out.push(
      item ?? {
        domain: goal.domain,
        target: goal.target,
        direction: goal.direction,
        priority: goal.priority,
        ...(goal.crisis ? { crisis: true } : {}),
      }
    );
    seen.add(goal.domain);
  }
  for (const item of agenda) {
    if (seen.has(item.domain)) continue;
    out.push(item);
    seen.add(item.domain);
  }
  const cap = Math.min(
    GOVERNING_ARCHETYPE_CLAMP.maxAgendaBreadth,
    Math.max(agenda.length, goals.length)
  );
  return out.slice(0, cap);
}

/** The domains a government is currently committed to. Drives sponsorship preference. */
export function committedGoalDomains(goals: readonly GoverningGoalRecord[]): Set<string> {
  return new Set(goals.filter((goal) => goal.status === "active").map((goal) => goal.domain));
}

/**
 * Whether a minister holds its standing tier rather than switching to a
 * better-scoring one this cycle.
 *
 * The 24-turn setting cooldown already stops per-turn churn. This is the layer
 * above it: even once the cooldown has expired, a committed posture is kept
 * unless there is a *reason* to break it — the brief is materially failing, an
 * emergency has arrived, or the standing tier has stopped helping at all.
 * Without this a minister flips posture on any marginal score change the moment
 * the cooldown lapses, which is the multi-turn-commitment gap V5 exists to close.
 */
export function ministerialCommitmentHolds(params: {
  currentTier: string | null;
  bestTier: string | null;
  currentScore: number;
  shortfall: number;
  crisis: boolean;
  policy: NppBehaviorPolicy;
}): boolean {
  const { currentTier, bestTier, currentScore, shortfall, crisis, policy } = params;
  if (!currentTier) return false; // Nothing committed yet.
  if (!bestTier || bestTier === currentTier) return false; // Nothing to switch to.
  if (crisis) return false; // Emergencies always re-plan.
  if (currentScore <= 0) return false; // The standing posture no longer advances the agenda.
  return shortfall < policy.replanShortfallThreshold;
}
