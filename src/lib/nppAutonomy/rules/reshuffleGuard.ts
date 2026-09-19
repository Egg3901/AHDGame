/**
 * reshuffleGuard — tenure, cooldown, and escalation rules for autonomous NPP
 * ministerial reshuffles (issue #1994).
 *
 * `runMinisterialGovernance` used to evaluate every minister every turn with
 * only a shortfall/propensity threshold (`shouldReshuffleMinister`), so a
 * portfolio whose domain shortfall never moved was dismissed and refilled
 * every turn: the replacement was judged against the same country-domain
 * state before its orders could act. This module is the bounded fix.
 *
 * Rules zone: pure data in, plain data out. No database, no wall clock, no
 * randomness, no env, nothing async — so the headless harness can copy this
 * module wholesale. The shell (`runMinisterialGovernance`) loads documents,
 * calls these functions, and writes results.
 *
 * Tenure and cooldowns are measured in turns against `TURNS_PER_YEAR = 48`:
 * - `MIN_MINISTER_TENURE_TURNS = 24` (half a game-year): one full
 *   ministerial-order cycle (`DEFAULT_ORDER_DURATION = 24`) and one full
 *   tier-setting cooldown (`SETTING_CHANGE_COOLDOWN_TURNS = 24`). A new
 *   minister is not blamed for a pre-existing shortfall before its levers
 *   have had one complete cycle to act.
 * - `PORTFOLIO_RESHUFFLE_COOLDOWN_TURNS = 24`: a seat cannot churn faster
 *   than a minister can be judged.
 * - `GOVERNMENT_RESHUFFLE_COOLDOWN_TURNS = 12` (quarter game-year): bounds
 *   same-turn mass purges to one reshuffle per window per government.
 * - `MAX_CONSECUTIVE_PORTFOLIO_RESHUFFLES = 2`: an unchanged structural
 *   shortfall gets at most two replacements per government, then the
 *   portfolio escalates and is left alone — the explicit bounded path.
 * - `SHORTFALL_STABILITY_EPSILON = 0.05`: shortfalls within this band of the
 *   last reshuffle's reading count as the same unchanged structural miss.
 *
 * All knobs live on `RESHUFFLE_GUARD_CONFIG` so worldsim can evaluate
 * alternatives without touching the rules.
 */

export const MIN_MINISTER_TENURE_TURNS = 24;
export const GOVERNMENT_RESHUFFLE_COOLDOWN_TURNS = 12;
export const PORTFOLIO_RESHUFFLE_COOLDOWN_TURNS = 24;
export const MAX_CONSECUTIVE_PORTFOLIO_RESHUFFLES = 2;
export const SHORTFALL_STABILITY_EPSILON = 0.05;

export interface ReshuffleGuardConfig {
  minMinisterTenureTurns: number;
  governmentReshuffleCooldownTurns: number;
  portfolioReshuffleCooldownTurns: number;
  maxConsecutivePortfolioReshuffles: number;
  shortfallStabilityEpsilon: number;
}

export const RESHUFFLE_GUARD_CONFIG: ReshuffleGuardConfig = {
  minMinisterTenureTurns: MIN_MINISTER_TENURE_TURNS,
  governmentReshuffleCooldownTurns: GOVERNMENT_RESHUFFLE_COOLDOWN_TURNS,
  portfolioReshuffleCooldownTurns: PORTFOLIO_RESHUFFLE_COOLDOWN_TURNS,
  maxConsecutivePortfolioReshuffles: MAX_CONSECUTIVE_PORTFOLIO_RESHUFFLES,
  shortfallStabilityEpsilon: SHORTFALL_STABILITY_EPSILON,
};

/** Per-portfolio reshuffle history for the current government. Persisted. */
export interface PortfolioReshuffleRecord {
  /** Turn of the most recent reshuffle of this portfolio (this government). */
  lastReshuffleTurn: number;
  /**
   * Consecutive reshuffles for an unchanged shortfall. Reset to 1 whenever a
   * reshuffle acts on a materially different shortfall.
   */
  consecutiveReshuffles: number;
  /** Shortfall reading the most recent reshuffle acted on. */
  lastShortfallAtReshuffle: number;
  /**
   * True once the portfolio exhausted its bounded replacements for an
   * unchanged shortfall — set by the replacement that reaches the cap, or by
   * the refusal marking when the cap was reached earlier. Cleared only by a
   * materially changed shortfall or a government transition.
   */
  escalated: boolean;
}

/** Observability record for the most recent replacement. Persisted. */
export interface LastReplacementRecord {
  positionId: string;
  turn: number;
  reason: string;
  priorTenureTurns: number | null;
  shortfall: number;
  consecutiveReshuffles: number;
  escalated: boolean;
}

/** Persisted reshuffle-guard state. Lives on the governmentFormation doc. */
export interface PersistedReshuffleGuardState {
  /**
   * Identity of the government this state belongs to
   * (`cycle:formedTurn:headId`). A mismatch means a government transition and
   * the state is read as empty — the new government starts clean.
   */
  governmentKey: string;
  /** Turn of the most recent reshuffle by this government (any portfolio). */
  lastReshuffleTurn: number | null;
  portfolios: Record<string, PortfolioReshuffleRecord>;
  lastReplacement: LastReplacementRecord | null;
}

/** Why a threshold-met minister was (or was not) reshuffled. */
export type ReshuffleBlockReason =
  "min-tenure" | "government-cooldown" | "portfolio-cooldown" | "escalated-structural";

export interface ReshuffleEligibility {
  eligible: boolean;
  /** Machine-readable reason; "threshold" when eligible. */
  reason: ReshuffleBlockReason | "threshold";
}

/**
 * Identity of the seated government for guard-state scoping. Pure.
 * Null-ish parts degrade to stable sentinels so legacy docs still key
 * deterministically.
 */
export function governmentKeyForReshuffle(gov: {
  cycle?: unknown;
  formedTurn?: unknown;
  headNppId?: unknown;
}): string {
  const cycle = typeof gov.cycle === "number" && Number.isFinite(gov.cycle) ? gov.cycle : "?";
  const formedTurn =
    typeof gov.formedTurn === "number" && Number.isFinite(gov.formedTurn) ? gov.formedTurn : "?";
  const head =
    gov.headNppId != null &&
    typeof (gov.headNppId as { toString?: unknown }).toString === "function"
      ? String(gov.headNppId)
      : "?";
  return `${cycle}:${formedTurn}:${head}`;
}

/**
 * Normalize persisted guard state for the current government. A missing doc
 * field, a corrupt shape, or a key mismatch (government transition) reads as
 * empty state — the new government starts with a clean slate. Pure.
 */
export function readReshuffleGuardState(
  persisted: unknown,
  governmentKey: string
): { lastReshuffleTurn: number | null; portfolios: Record<string, PortfolioReshuffleRecord> } {
  const empty = { lastReshuffleTurn: null as number | null, portfolios: {} };
  if (!persisted || typeof persisted !== "object") return { ...empty, portfolios: {} };
  const state = persisted as Partial<PersistedReshuffleGuardState>;
  if (state.governmentKey !== governmentKey) return { ...empty, portfolios: {} };
  const portfolios: Record<string, PortfolioReshuffleRecord> = {};
  if (state.portfolios && typeof state.portfolios === "object") {
    for (const [positionId, record] of Object.entries(state.portfolios)) {
      if (!record || typeof record !== "object") continue;
      const lastReshuffleTurn = (record as { lastReshuffleTurn?: unknown }).lastReshuffleTurn;
      const consecutiveReshuffles = (record as { consecutiveReshuffles?: unknown })
        .consecutiveReshuffles;
      const lastShortfallAtReshuffle = (record as { lastShortfallAtReshuffle?: unknown })
        .lastShortfallAtReshuffle;
      const escalated = (record as { escalated?: unknown }).escalated;
      if (
        typeof lastReshuffleTurn !== "number" ||
        !Number.isFinite(lastReshuffleTurn) ||
        typeof consecutiveReshuffles !== "number" ||
        !Number.isFinite(consecutiveReshuffles) ||
        typeof lastShortfallAtReshuffle !== "number" ||
        !Number.isFinite(lastShortfallAtReshuffle) ||
        typeof escalated !== "boolean"
      ) {
        continue;
      }
      portfolios[positionId] = {
        lastReshuffleTurn,
        consecutiveReshuffles,
        lastShortfallAtReshuffle,
        escalated,
      };
    }
  }
  const lastReshuffleTurn =
    typeof state.lastReshuffleTurn === "number" && Number.isFinite(state.lastReshuffleTurn)
      ? state.lastReshuffleTurn
      : null;
  return { lastReshuffleTurn, portfolios };
}

/**
 * Turns since appointment, or null when the seat predates turn-stamping
 * (legacy docs carry only `appointedAt`). Null waives the tenure check so
 * pre-existing cabinets keep their old eligibility instead of freezing.
 * Pure. Non-finite or future stamps coerce to null / 0 deterministically.
 */
export function ministerTenureTurns(appointedTurn: unknown, currentTurn: number): number | null {
  if (typeof appointedTurn !== "number" || !Number.isFinite(appointedTurn)) return null;
  return Math.max(0, currentTurn - appointedTurn);
}

/** Whether two shortfall readings are the same unchanged structural miss. Pure. */
export function isUnchangedShortfall(
  current: number,
  lastAtReshuffle: number,
  epsilon = SHORTFALL_STABILITY_EPSILON
): boolean {
  return Math.abs(current - lastAtReshuffle) <= epsilon;
}

/**
 * Full eligibility for a minister that already met the underperformance
 * threshold (`shouldReshuffleMinister`). Tenure is checked first so a new
 * minister is never blamed for a pre-existing shortfall; then the
 * government and portfolio cooldowns; then the structural-escalation cap.
 * Pure.
 */
export function evaluateReshuffleEligibility(params: {
  /** Already met the shortfall/propensity threshold. False short-circuits. */
  thresholdMet: boolean;
  /** Null (legacy unstamped seat) waives the tenure check. */
  tenureTurns: number | null;
  /** Null when this government has never reshuffled. */
  turnsSinceGovernmentReshuffle: number | null;
  portfolio: PortfolioReshuffleRecord | null;
  shortfall: number;
  currentTurn: number;
  config?: ReshuffleGuardConfig;
}): ReshuffleEligibility {
  const {
    thresholdMet,
    tenureTurns,
    turnsSinceGovernmentReshuffle,
    portfolio,
    shortfall,
    currentTurn,
    config = RESHUFFLE_GUARD_CONFIG,
  } = params;
  if (!thresholdMet) return { eligible: false, reason: "threshold" };
  if (tenureTurns !== null && tenureTurns < config.minMinisterTenureTurns) {
    return { eligible: false, reason: "min-tenure" };
  }
  if (
    turnsSinceGovernmentReshuffle !== null &&
    turnsSinceGovernmentReshuffle < config.governmentReshuffleCooldownTurns
  ) {
    return { eligible: false, reason: "government-cooldown" };
  }
  if (portfolio) {
    const turnsSincePortfolio = currentTurn - portfolio.lastReshuffleTurn;
    if (turnsSincePortfolio < config.portfolioReshuffleCooldownTurns) {
      return { eligible: false, reason: "portfolio-cooldown" };
    }
    const unchanged = isUnchangedShortfall(
      shortfall,
      portfolio.lastShortfallAtReshuffle,
      config.shortfallStabilityEpsilon
    );
    if (
      unchanged &&
      (portfolio.escalated ||
        portfolio.consecutiveReshuffles >= config.maxConsecutivePortfolioReshuffles)
    ) {
      return { eligible: false, reason: "escalated-structural" };
    }
  }
  return { eligible: true, reason: "threshold" };
}

/**
 * Portfolio record after a reshuffle at `currentTurn` acted on `shortfall`.
 * An unchanged shortfall increments the consecutive counter; a materially
 * changed one restarts it at 1 with escalation cleared (new information, new
 * bounded run). The replacement that reaches the consecutive cap marks the
 * portfolio escalated immediately, so the persisted state — and the
 * `lastReplacement` observability record built from it — reports the
 * exhaustion without waiting for the next refused evaluation. Pure.
 */
export function nextPortfolioRecordOnReshuffle(params: {
  prior: PortfolioReshuffleRecord | null;
  shortfall: number;
  currentTurn: number;
  config?: ReshuffleGuardConfig;
}): PortfolioReshuffleRecord {
  const { prior, shortfall, currentTurn, config = RESHUFFLE_GUARD_CONFIG } = params;
  const unchanged =
    prior !== null &&
    isUnchangedShortfall(
      shortfall,
      prior.lastShortfallAtReshuffle,
      config.shortfallStabilityEpsilon
    );
  const consecutiveReshuffles = unchanged ? prior.consecutiveReshuffles + 1 : 1;
  return {
    lastReshuffleTurn: currentTurn,
    consecutiveReshuffles,
    lastShortfallAtReshuffle: shortfall,
    escalated: consecutiveReshuffles >= config.maxConsecutivePortfolioReshuffles,
  };
}

/**
 * Portfolio record to persist when a reshuffle is refused for an unchanged
 * structural shortfall at the escalation cap: the history is kept and the
 * portfolio is marked escalated so later turns refuse without further writes
 * until the shortfall moves or the government changes. Pure.
 */
export function markPortfolioEscalated(prior: PortfolioReshuffleRecord): PortfolioReshuffleRecord {
  return { ...prior, escalated: true };
}
