/**
 * Regional budgets alternate turns.
 *
 * The five regional-budget phases recompute every region's annual budget from
 * its enacted laws and drift value bases toward a policy target. Nothing in
 * them accrues a per-turn flow: run every other turn with the drift scaled to
 * two turns, a region ends up in the same place, one turn later. What running
 * every turn costs is ~20,000 documents decoded per turn (DE alone reads
 * 9,000 sector rows because nearly every corporation there is state-owned),
 * on every turn, for every player.
 *
 * Slots are balanced by measured cost: DE + RU + UK on even turns, JP + CN on
 * odd turns. `AHD_REGIONAL_BUDGET_EVERY_TURNS=1` restores every-turn
 * processing without a deploy. The phase keys are the identifiers turn logs
 * and turndiag are keyed by, so a skipped phase is marked "skipped:
 * conditional" rather than silently absent.
 */

export const REGIONAL_BUDGET_EVERY_TURNS = 2;

/** Phase key -> slot. A phase runs when `turn % cadence === slot % cadence`. */
export const REGIONAL_BUDGET_PHASE_SLOTS: Readonly<Record<string, number>> = {
  deRegionalBudgetProcessing: 0,
  ruRegionalBudgetProcessing: 0,
  regionalBudgetProcessing: 0,
  jpRegionalBudgetProcessing: 1,
  cnRegionalBudgetProcessing: 1,
};

export function resolveRegionalBudgetCadence(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = env.AHD_REGIONAL_BUDGET_EVERY_TURNS;
  const parsed = raw === undefined || raw === "" ? REGIONAL_BUDGET_EVERY_TURNS : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return REGIONAL_BUDGET_EVERY_TURNS;
  return Math.min(parsed, 4);
}

/** Whether a regional-budget phase is due on `currentTurn`. Unknown keys always run. */
export function regionalBudgetPhaseDue(
  phase: string,
  currentTurn: number,
  everyTurns: number = resolveRegionalBudgetCadence()
): boolean {
  if (everyTurns <= 1) return true;
  const slot = REGIONAL_BUDGET_PHASE_SLOTS[phase];
  if (slot === undefined) return true;
  return currentTurn % everyTurns === slot % everyTurns;
}
