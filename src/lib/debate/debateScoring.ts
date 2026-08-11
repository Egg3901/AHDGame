import { statMultiplier } from "@/lib/stats/statMultiplier";
import { NEUTRAL_STAT, type CharacterStats, type StatKey } from "@/lib/stats/statsConstants";

/**
 * Election-debate scoring (Phase 3). A challenged candidate commits to a single
 * risk/reward strategy archetype, scoring `statMultiplier(linkedStat) ×
 * baseReward + roll(risk band)`. The two sides' scores are compared to decide
 * the favorability swing. Bases are equal across archetypes so the linked stat
 * decides the best pick. All magnitudes are tunable constants. `rng` (→ [0,1))
 * is injected for deterministic testing.
 */

export type DebateStrategy = "attack" | "aboveFray" | "tout";

export const DEBATE_STRATEGIES: readonly DebateStrategy[] = ["attack", "aboveFray", "tout"];

export interface DebateStrategyMeta {
  label: string;
  blurb: string;
  linkedStat: StatKey;
  /** Base reward before the stat multiplier (tout's effective base scales with record). */
  baseReward: number;
  /** Inclusive roll band added to the scaled base — width encodes the risk profile. */
  rollMin: number;
  rollMax: number;
}

export const DEBATE_STRATEGY_META: Record<DebateStrategy, DebateStrategyMeta> = {
  attack: {
    label: "Attack opponent",
    blurb: "Go on the offensive. High reward, but it can backfire and look like bullying.",
    linkedStat: "debate",
    // Debates are one-pick: bases are equal so your strongest stat (not a fixed
    // reward gap) decides the best choice. Attack's risk/reward lives in its
    // wide roll band, not a higher base.
    baseReward: 8,
    rollMin: -6,
    rollMax: 10,
  },
  aboveFray: {
    label: "Remain above the fray",
    blurb: "Stay presidential and measured. A safe floor with limited upside.",
    linkedStat: "charisma",
    baseReward: 8,
    rollMin: -1,
    rollMax: 2,
  },
  tout: {
    label: "Tout accomplishments",
    blurb: "Run on your record. Pays off when the record is real; falls flat when it's thin.",
    linkedStat: "statecraft",
    baseReward: 8,
    rollMin: -3,
    rollMax: 4,
  },
};

/** Player record that scales the Tout archetype. */
export interface DebateRecord {
  officesHeld: number;
  billsPassed: number;
}

/** A side's debate input: chosen strategies, stat block, and (for Tout) record. */
export interface DebateSide {
  strategies: DebateStrategy[];
  stats?: Partial<CharacterStats>;
  record?: DebateRecord;
}

/** Real-time deadline for a challenged player to pick strategies before auto-resolve. */
export const DEBATE_STRATEGY_DEADLINE_MS = 12 * 60 * 60 * 1000;
/** Per-PREE-pass chance that an opponent challenges an in-election candidate to a debate. */
export const DEBATE_CHALLENGE_CHANCE = 0.5;

/**
 * Cap on how many debates a single candidate can be pulled into per election.
 * Debates auto-spawn each turn at {@link DEBATE_CHALLENGE_CHANCE}, so without a
 * ceiling a candidate could rack up dozens over a campaign and farm favorability
 * by repeatedly out-debating NPPs. Counts a candidate's debates whether they were
 * the challenger or the opponent, across awaiting + resolved sessions.
 */
export const DEBATE_MAX_PER_ELECTION = 3;

/** Draw threshold: totals within this margin are a tie. */
export const DEBATE_DRAW_THRESHOLD = 2;
/** Favorability swing bounds for a decisive result. */
export const DEBATE_MIN_SWING = 3;
export const DEBATE_MAX_SWING = 8;
/** Points of margin beyond the draw threshold per +1 of favorability swing. */
export const DEBATE_MARGIN_PER_SWING = 4;

function statOf(side: DebateSide, key: StatKey): number {
  return side.stats?.[key] ?? NEUTRAL_STAT;
}

/**
 * Tout's effective base scales with a real record: a strong record lifts it to
 * the full base, a thin record drops it negative (the archetype backfires).
 */
function toutRecordFactor(record: DebateRecord | undefined): number {
  const r = record ?? { officesHeld: 0, billsPassed: 0 };
  const raw = r.officesHeld * 0.4 + r.billsPassed * 0.1;
  // 0 record → -0.3 (mild backfire); a real record (raw ≥ 1.0) → 1.0 (full
  // payoff, so a statecraft-strong incumbent's best pick is Tout, not Attack).
  return Math.min(1, raw) * 1.3 - 0.3;
}

/** Score a single strategy for a side, given a roll in the strategy's band. */
export function scoreStrategy(side: DebateSide, strategy: DebateStrategy, roll: number): number {
  const meta = DEBATE_STRATEGY_META[strategy];
  const mult = statMultiplier(statOf(side, meta.linkedStat));
  const base =
    strategy === "tout" ? meta.baseReward * toutRecordFactor(side.record) : meta.baseReward;
  return mult * base + roll;
}

/** Roll within a strategy's risk band using the injected rng. */
function bandRoll(strategy: DebateStrategy, rng: () => number): number {
  const { rollMin, rollMax } = DEBATE_STRATEGY_META[strategy];
  return rollMin + rng() * (rollMax - rollMin);
}

/** Total a side's score across its chosen strategies (deduplicated, max 3). */
export function scoreSide(side: DebateSide, rng: () => number): number {
  const chosen = [...new Set(side.strategies)].slice(0, 3);
  return chosen.reduce((sum, s) => sum + scoreStrategy(side, s, bandRoll(s, rng)), 0);
}

/**
 * Expected (roll-free) value of a strategy for a side — its scaled base reward.
 * Used by the AI opponent to rank archetypes by fit.
 */
export function expectedStrategyValue(side: DebateSide, strategy: DebateStrategy): number {
  return scoreStrategy(side, strategy, 0);
}

/**
 * Choose the strategy for an AI-resolved opponent: the single archetype with
 * the highest expected value for their stats/record. Debates are one-pick, so
 * the AI commits to its best fit — matching what a player may choose. Returned
 * as a one-element array for parity with a submitted side's shape.
 */
export function pickAiStrategies(side: Omit<DebateSide, "strategies">): DebateStrategy[] {
  const best = [...DEBATE_STRATEGIES]
    .map((s) => ({ s, ev: expectedStrategyValue({ ...side, strategies: [s] }, s) }))
    .sort((a, b) => b.ev - a.ev)[0];
  return [best.s];
}

export interface DebateOutcome {
  challengerTotal: number;
  opponentTotal: number;
  /** Signed: challenger − opponent. */
  margin: number;
  result: "challenger" | "opponent" | "draw";
  /** Favorability swing magnitude applied (+ to winner, − to loser). 0 on a draw. */
  favorabilitySwing: number;
}

/** Map an absolute margin to a bounded favorability swing. */
export function marginToSwing(absMargin: number): number {
  if (absMargin < DEBATE_DRAW_THRESHOLD) return 0;
  const extra = Math.floor((absMargin - DEBATE_DRAW_THRESHOLD) / DEBATE_MARGIN_PER_SWING);
  return Math.min(DEBATE_MAX_SWING, DEBATE_MIN_SWING + extra);
}

/**
 * Resolve a debate between a challenger and an opponent. Pure given `rng`.
 */
export function resolveDebate(
  challenger: DebateSide,
  opponent: DebateSide,
  rng: () => number
): DebateOutcome {
  const challengerTotal = scoreSide(challenger, rng);
  const opponentTotal = scoreSide(opponent, rng);
  const margin = challengerTotal - opponentTotal;
  const absMargin = Math.abs(margin);

  if (absMargin < DEBATE_DRAW_THRESHOLD) {
    return { challengerTotal, opponentTotal, margin, result: "draw", favorabilitySwing: 0 };
  }
  return {
    challengerTotal,
    opponentTotal,
    margin,
    result: margin > 0 ? "challenger" : "opponent",
    favorabilitySwing: marginToSwing(absMargin),
  };
}
