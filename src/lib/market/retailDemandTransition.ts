/**
 * Temporary unwind for Retail's legacy supply-derived demand.
 *
 * The old ledger added `retail supply * GDP multiplier` back as demand. That
 * made every new store manufacture its own customers, so Retail could never
 * saturate. Production worlds cannot drop that demand in one turn without
 * wiping out incumbent owners, so an explicitly started transition fades the
 * legacy contribution to zero. Once it reaches zero it stays there.
 */

export const RETAIL_DEMAND_TRANSITION_DEFAULT_TURNS = 192;

export interface RetailDemandTransitionConfig {
  retailDemandTransitionStartTurn?: number | null;
  retailDemandTransitionTurns?: number | null;
}

const finiteTurn = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Remaining share of the legacy Retail self-loop, in [0, 1].
 *
 * An absent start turn preserves legacy behavior. Operators must deliberately
 * start the unwind per world; this avoids silently changing sandboxes and old
 * fixtures merely because code was deployed.
 */
export function retailLegacyDemandFactor(
  config: RetailDemandTransitionConfig | null | undefined,
  currentTurn: number
): number {
  const start = config?.retailDemandTransitionStartTurn;
  if (!finiteTurn(start)) return 1;

  const configuredTurns = config?.retailDemandTransitionTurns;
  const duration =
    finiteTurn(configuredTurns) && configuredTurns > 0
      ? configuredTurns
      : RETAIL_DEMAND_TRANSITION_DEFAULT_TURNS;
  const elapsed = Math.max(0, currentTurn - start);
  return Math.max(0, Math.min(1, 1 - elapsed / duration));
}

/** New Retail capacity is paused only while the legacy loop is unwinding. */
export function retailCapacityExpansionPaused(
  config: RetailDemandTransitionConfig | null | undefined,
  currentTurn: number
): boolean {
  return (
    finiteTurn(config?.retailDemandTransitionStartTurn) &&
    retailLegacyDemandFactor(config, currentTurn) > 0
  );
}

export function retailDemandTransitionTurnsRemaining(
  config: RetailDemandTransitionConfig | null | undefined,
  currentTurn: number
): number {
  const start = config?.retailDemandTransitionStartTurn;
  if (!finiteTurn(start)) return 0;
  const configuredTurns = config?.retailDemandTransitionTurns;
  const duration =
    finiteTurn(configuredTurns) && configuredTurns > 0
      ? configuredTurns
      : RETAIL_DEMAND_TRANSITION_DEFAULT_TURNS;
  return Math.max(0, Math.ceil(start + duration - currentTurn));
}
