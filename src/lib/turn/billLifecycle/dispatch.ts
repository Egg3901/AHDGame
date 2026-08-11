import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { runBillLifecycle } from "./engine";
import { JP_NATIONAL_CONFIG } from "./configs/jp";
import type { BillLifecycleConfig } from "./types";

/**
 * Registry-facing wrapper for country bill lifecycles dispatched via
 * `COUNTRY_BILL_PHASES` (UK/DE/IE/CN/JP/RU as they migrate). Resolves the db +
 * current turn and maps the engine result to the `{ enacted, failed }` shape the
 * registry's `emptyResult` expects.
 *
 * (US Congress keeps its own `processBillLifecycle` entry point in billLifecycle.ts
 * because the main turn registry consumes its richer `BillLifecycleResult`.)
 */
export async function runBillLifecycleForCountry(
  config: BillLifecycleConfig,
  now: Date
): Promise<{ enacted: number; failed: number }> {
  const db = await getDb();
  const gameState = await getGameState();
  const currentTurn = gameState?.currentTurn ?? 1;
  const result = await runBillLifecycle(db, config, now, currentTurn);
  return { enacted: result.billsPassed, failed: result.billsFailed };
}

/**
 * JP-specific dispatch: the Diet registry entry reports four counters
 * `{enacted, failed, overrides, cabinetPassed}` derived from the engine's
 * transitions-by-target-status (a Sangiin→override transition is neither a pass
 * nor a fail; cabinet→active is a distinct "passed review").
 */
export async function runBillLifecycleForJP(
  now: Date
): Promise<{ enacted: number; failed: number; overrides: number; cabinetPassed: number }> {
  const db = await getDb();
  const gameState = await getGameState();
  const currentTurn = gameState?.currentTurn ?? 1;
  const t = (await runBillLifecycle(db, JP_NATIONAL_CONFIG, now, currentTurn)).transitionedTo;
  return {
    enacted: t.signed ?? 0,
    failed: t.failed ?? 0,
    overrides: t.override_shugiin ?? 0,
    cabinetPassed: t.active ?? 0,
  };
}
