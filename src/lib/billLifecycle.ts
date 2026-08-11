/**
 * Bill Lifecycle Processor (US Congress) — thin dispatcher.
 *
 * The lifecycle state machine now lives in the unified, config-driven engine
 * (src/lib/turn/billLifecycle/engine.ts). US Congress routes through it via
 * US_NATIONAL_CONFIG (house/senate/joint origin → second chamber → presidential
 * window → veto override). This module keeps the public `processBillLifecycle`
 * entry point (called by the turn phase registry) and re-exports the shared
 * helpers that external consumers import from "@/lib/billLifecycle".
 *
 * NPP auto-voting is handled by the unified nppBehavior phase (src/lib/turn/nppBehavior.ts).
 */
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { runBillLifecycle, type BillLifecycleResult } from "@/lib/turn/billLifecycle/engine";
import { US_NATIONAL_CONFIG } from "@/lib/turn/billLifecycle/configs/us";

// Re-exported for external consumers (admin route, unit tests) that import from
// "@/lib/billLifecycle".
export {
  didPassWithFilibusterCheck,
  notifyPresidentBillAwaitingSignature,
} from "@/lib/turn/billLifecycle/lifecycleHelpers";
export type { BillLifecycleResult };

export async function processBillLifecycle(now: Date): Promise<BillLifecycleResult> {
  const db = await getDb();
  const gameState = await getGameState();
  const currentTurn = gameState?.currentTurn ?? 1;
  return runBillLifecycle(db, US_NATIONAL_CONFIG, now, currentTurn);
}
