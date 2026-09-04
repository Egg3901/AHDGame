import type { OperationCompromise, OperationOutcome } from "@/lib/db/types/intelligence";
import { COVERAGE_MAX, NETWORK_MAX_LEVEL, TRADECRAFT_MAX, TRADECRAFT_MIN } from "./config";

/**
 * Everything the resolver needs, as plain numbers. No database, no clock, no RNG
 * of its own: both rolls are injected, the way `stepCovertProgram` injects its
 * roll, so the whole ladder is testable without stubbing globals.
 */
export interface OperationInput {
  /** 0..NETWORK_MAX_LEVEL */
  networkLevel: number;
  /** Live coverage, 0..COVERAGE_MAX — already decayed by the caller. */
  coverage: number;
  /** Agency capability, TRADECRAFT_MIN..TRADECRAFT_MAX */
  tradecraft: number;
  /** Director's stat efficacy, roughly 0.8..1.2. Neutral 1 when the seat is vacant. */
  statMultiplier: number;
  /** Target's defensive posture, 0..100 */
  counterIntel: number;
  /** The network's heat, 0..100 */
  suspicion: number;
  /** Operation difficulty, 0..100 */
  difficulty: number;
  /** [0, 1) */
  successRoll: number;
  /** [0, 1) */
  compromiseRoll: number;
}

export interface OperationResolution {
  outcome: OperationOutcome;
  compromise: OperationCompromise;
  /** Exposed for the op log's rollDetail and for sim reports. Never served to a target. */
  successChance: number;
  compromiseChance: number;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function normalizedTradecraft(tradecraft: number): number {
  const span = TRADECRAFT_MAX - TRADECRAFT_MIN;
  return clamp01((tradecraft - TRADECRAFT_MIN) / span);
}

/**
 * Two INDEPENDENT rolls, deliberately.
 *
 * `outcome` asks whether the operation did its job. `compromise` asks how badly it
 * was exposed. Rolling them together would make attribution a kind of failure,
 * and the most interesting Cold War result — you took the thing and everyone knows
 * you took it — would be unrepresentable.
 */
export function resolveOperation(input: OperationInput): OperationResolution {
  const successChance = clamp01(
    (0.15 +
      0.35 * clamp01(input.networkLevel / NETWORK_MAX_LEVEL) +
      0.25 * clamp01(input.coverage / COVERAGE_MAX) +
      0.25 * normalizedTradecraft(input.tradecraft)) *
      Math.max(0, input.statMultiplier) -
      clamp01(input.difficulty / 100)
  );
  const outcome: OperationOutcome = input.successRoll < successChance ? "success" : "miss";

  // Heat dominates, the defender's posture matters, tradecraft buys quiet.
  const compromiseChance = clamp01(
    0.05 +
      0.5 * clamp01(input.suspicion / 100) +
      0.35 * clamp01(input.counterIntel / 100) -
      0.2 * normalizedTradecraft(input.tradecraft)
  );

  if (input.compromiseRoll >= compromiseChance) {
    return { outcome, compromise: "clean", successChance, compromiseChance };
  }

  // Inside the compromised band, how DEEP the roll landed picks the rung, and a
  // better counter-intelligence service turns more compromises into attributions.
  const depth = compromiseChance > 0 ? clamp01(input.compromiseRoll / compromiseChance) : 0;
  const attributedShare = clamp01(0.15 + 0.5 * clamp01(input.counterIntel / 100));
  const detectedShare = clamp01(attributedShare + 0.3);

  const compromise: OperationCompromise =
    depth < attributedShare ? "attributed" : depth < detectedShare ? "detected" : "blown";

  return { outcome, compromise, successChance, compromiseChance };
}
