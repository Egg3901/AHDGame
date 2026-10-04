/** Apply symmetric reserve leverage without privileging the attacker role. */
export function applyReserveOdds(
  forceRatio: number,
  attackerReserve: number,
  defenderReserve: number
): number {
  const ratio = Number.isFinite(forceRatio) ? Math.max(0, Math.min(1, forceRatio)) : 0.5;
  const attacker = Number.isFinite(attackerReserve) ? Math.max(0, Math.min(1, attackerReserve)) : 0;
  const defender = Number.isFinite(defenderReserve) ? Math.max(0, Math.min(1, defenderReserve)) : 0;
  const leverage = 0.1 * (1 - Math.abs(ratio - 0.5) * 2);
  return Math.max(0.02, Math.min(0.98, ratio + attacker * leverage - defender * leverage));
}

/**
 * Preserve the outcome-calibrating fortune draw while capping how destructive a
 * lucky day can make the five-round attrition exchange.
 */
export function battleEffectiveRatio(
  projectedRatio: number,
  fortuneRoll: number,
  outcomeSpread: number,
  severitySpread: number
): number {
  const ratio = Number.isFinite(projectedRatio) ? Math.max(0, Math.min(1, projectedRatio)) : 0.5;
  const roll = Number.isFinite(fortuneRoll) ? Math.max(0, Math.min(1, fortuneRoll)) : 0.5;
  const spread = Number.isFinite(outcomeSpread) ? Math.max(0, outcomeSpread) : 0;
  const severity = Number.isFinite(severitySpread) ? Math.max(0, Math.min(0.5, severitySpread)) : 0;
  const outcomeRatio = ratio + (roll - 0.5) * 2 * spread;
  return 0.5 + Math.max(-severity, Math.min(severity, outcomeRatio - 0.5));
}
