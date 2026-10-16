/**
 * Declared currency pegs use reserve-funded point defence through
 * effectiveInterventionPolicy. Legacy bands keep their bounds and history.
 */
import type { ExchangeRate, InterventionPolicy } from "@/lib/db/types/exchangeRate";

export function effectiveInterventionPolicy(
  fx: Pick<ExchangeRate, "fxRegime" | "pegTarget" | "interventionPolicy" | "fxRegimeSetAtTurn">
): InterventionPolicy | null {
  const policy = fx.interventionPolicy ?? null;
  if (fx.fxRegime !== "peg") return policy;
  const target = fx.pegTarget;
  if (target == null || !Number.isFinite(target) || target <= 0) return null;
  const pointPolicy = policy?.floor === target && policy.ceiling === target ? policy : null;
  return {
    ...policy,
    floor: target,
    ceiling: target,
    setByCharacterId: pointPolicy?.setByCharacterId ?? null,
    setByCharacterName: pointPolicy?.setByCharacterName ?? null,
    setAtTurn: fx.fxRegimeSetAtTurn ?? pointPolicy?.setAtTurn ?? null,
    lastAdjustedAtTurn: fx.fxRegimeSetAtTurn ?? pointPolicy?.lastAdjustedAtTurn ?? null,
    recentInterventions: policy?.recentInterventions ?? [],
  };
}
