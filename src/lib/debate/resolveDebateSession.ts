import {
  resolveDebate,
  pickAiStrategies,
  type DebateStrategy,
  type DebateOutcome,
  type DebateSide,
  type DebateRecord,
} from "./debateScoring";
import type { CharacterStats } from "@/lib/stats/statsConstants";

/** Minimal participant shape the resolver needs (DB-agnostic). */
export interface DebateResolveInput {
  stats: Partial<CharacterStats>;
  record: DebateRecord;
  /** null → not submitted; the resolver fills it from stats (AI / non-responder). */
  strategies: DebateStrategy[] | null;
}

export interface ResolvedDebateSession {
  outcome: DebateOutcome;
  /** Strategies actually used (AI-filled where a side didn't submit). */
  challengerStrategies: DebateStrategy[];
  opponentStrategies: DebateStrategy[];
  /** Signed favorability deltas to apply to each side. */
  deltas: { challenger: number; opponent: number };
}

/**
 * Resolve a side's single lead strategy: its first submitted pick (debates are
 * one-pick), or an AI choice from its stats when it didn't (or couldn't) submit.
 */
function finalizeStrategies(p: DebateResolveInput): DebateStrategy[] {
  if (p.strategies && p.strategies.length > 0) return [p.strategies[0]];
  return pickAiStrategies({ stats: p.stats, record: p.record });
}

function toSide(p: DebateResolveInput, strategies: DebateStrategy[]): DebateSide {
  return { strategies, stats: p.stats, record: p.record };
}

/**
 * Resolve a debate session given both sides' (possibly unsubmitted) inputs.
 * Pure given `rng`. Non-submitted sides are AI-filled from their stats. Maps the
 * margin-scaled outcome to signed favorability deltas (winner +, loser −, draw 0).
 */
export function resolveDebateSession(
  challenger: DebateResolveInput,
  opponent: DebateResolveInput,
  rng: () => number
): ResolvedDebateSession {
  const challengerStrategies = finalizeStrategies(challenger);
  const opponentStrategies = finalizeStrategies(opponent);

  const outcome = resolveDebate(
    toSide(challenger, challengerStrategies),
    toSide(opponent, opponentStrategies),
    rng
  );

  const swing = outcome.favorabilitySwing;
  const deltas =
    outcome.result === "challenger"
      ? { challenger: swing, opponent: -swing }
      : outcome.result === "opponent"
        ? { challenger: -swing, opponent: swing }
        : { challenger: 0, opponent: 0 };

  return { outcome, challengerStrategies, opponentStrategies, deltas };
}
