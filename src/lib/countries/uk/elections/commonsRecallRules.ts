/**
 * Pure rules for UK Commons by-elections + recall petitions (epic #856, #860).
 *
 * Plain data in, plain data out. No DB, no clock, no randomness: the turn
 * phase and API routes load documents, call these, and write results.
 *
 * Balance constants below are first-pass values: they need worldsim
 * validation before anyone treats them as tuned. This branch is worldsim-gated.
 */

/** Infamy at or above this opens a recall petition immediately. */
export const RECALL_INFAMY_THRESHOLD = 70;
/** Favorability at or below this counts as a low-approval turn. */
export const RECALL_LOW_APPROVAL_LINE = 25;
/** Consecutive low-approval turns that open a recall petition. */
export const RECALL_SUSTAINED_TURNS = 4;
/** Player signatures that open a petition from a watch. */
export const RECALL_SIGNATURES_REQUIRED = 5;
/** Turns a petition stays open collecting signatures before it expires. */
export const RECALL_PETITION_OPEN_TURNS = 12;
/** Length of the constituency support-check window, in turns. */
export const RECALL_SUPPORT_WINDOW_TURNS = 6;
/** Filings window for the by-election itself. */
export const COMMONS_BY_ELECTION_FILING_TURNS = 24;
/** General window for the by-election itself. */
export const COMMONS_BY_ELECTION_GENERAL_TURNS = 24;
/** Turns after a resolved by-election before the same seat may spawn another. */
export const COMMONS_BY_ELECTION_RETRY_COOLDOWN_TURNS = 48;

/**
 * Incumbency bias for the support check, in declaration-equivalents. A
 * petition that splits the constituency evenly retains the MP; removal needs
 * to beat retention by more than this plus the favorability drag.
 */
export const RECALL_RETAIN_BIAS = 2;

export type RecallAutoTrigger = "infamy" | "lowApproval" | null;

export interface RecallTriggerInput {
  infamy: number;
  /** Current favorability (0..100) of the MP. */
  favorability: number;
  /** Consecutive low-approval turns BEFORE this evaluation. */
  lowStreak: number;
}

/**
 * Decide whether this turn opens (or keeps counting toward) a recall.
 * Returns the trigger when the petition should open now, otherwise null.
 * The caller persists the updated streak.
 */
export function evaluateRecallTrigger(input: RecallTriggerInput): {
  trigger: RecallAutoTrigger;
  lowStreak: number;
} {
  if (input.infamy >= RECALL_INFAMY_THRESHOLD) {
    return { trigger: "infamy", lowStreak: input.lowStreak };
  }
  if (input.favorability <= RECALL_LOW_APPROVAL_LINE) {
    const lowStreak = input.lowStreak + 1;
    return {
      trigger: lowStreak >= RECALL_SUSTAINED_TURNS ? "lowApproval" : null,
      lowStreak,
    };
  }
  return { trigger: null, lowStreak: 0 };
}

export interface SupportCheckInput {
  removeDeclarations: number;
  retainDeclarations: number;
  /** Mean favorability across the window samples (0..100). */
  meanFavorability: number;
}

/**
 * Deterministic support-check resolution. Removal wins only when declared
 * removal plus the favorability drag clears declared retention plus the
 * incumbency bias. No randomness: same inputs always give the same outcome.
 */
export function resolveSupportCheck(input: SupportCheckInput): "vacated" | "retained" {
  const favorability = Math.max(0, Math.min(100, input.meanFavorability));
  const favorabilityDrag = Math.max(0, (50 - favorability) / 10);
  const removeScore = Math.max(0, input.removeDeclarations) + favorabilityDrag;
  const retainScore = Math.max(0, input.retainDeclarations) + RECALL_RETAIN_BIAS;
  return removeScore > retainScore ? "vacated" : "retained";
}

/** Mean of favorability samples; empty window reads neutral 50. */
export function meanSupportSample(samples: Array<{ favorability: number }>): number {
  if (samples.length === 0) return 50;
  const sum = samples.reduce((total, s) => total + s.favorability, 0);
  return sum / samples.length;
}

export interface PetitionAdvanceInput {
  status: "watch" | "open" | "check";
  currentTurn: number;
  openedTurn?: number;
  checkEndTurn?: number;
  signatures: number;
}

/**
 * Per-turn pipeline step for a non-terminal petition. Returns the action the
 * shell must take; the shell owns all writes. Pure: same doc + turn always
 * yields the same step, so turn retries are safe.
 */
export function nextPetitionStep(
  input: PetitionAdvanceInput
): "wait" | "open" | "check" | "resolve" | "expire" {
  if (input.status === "check") {
    return typeof input.checkEndTurn === "number" && input.currentTurn >= input.checkEndTurn
      ? "resolve"
      : "wait";
  }
  if (input.status === "open") {
    if (input.signatures >= RECALL_SIGNATURES_REQUIRED) return "check";
    if (
      typeof input.openedTurn === "number" &&
      input.currentTurn >= input.openedTurn + RECALL_PETITION_OPEN_TURNS
    ) {
      return "expire";
    }
    return "wait";
  }
  return "wait";
}

/** First turn the support window may resolve (inclusive end bound). */
export function supportWindowEnd(checkStartTurn: number): number {
  return checkStartTurn + RECALL_SUPPORT_WINDOW_TURNS;
}
