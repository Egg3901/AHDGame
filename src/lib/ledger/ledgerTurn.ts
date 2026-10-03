import { AsyncLocalStorage } from "node:async_hooks";
import type { Db } from "mongodb";

/**
 * The turn whose closing balance snapshot captures cash that moves now.
 *
 * Turn T reconciles against the snapshot written near the end of processing T.
 * The game clock (`gameState.currentTurn`) only advances when a turn completes:
 * while turn T is processing it still reads T - 1, and between turns it reads
 * the turn already reconciled. Either way, cash that moves now lands in the next
 * closing snapshot, so a witness stamped with the clock itself is reconciled a
 * turn early, against a snapshot that never saw it.
 */
export function ledgerTurnFromClock(currentTurn: number): number {
  return currentTurn + 1;
}

const processingTurn = new AsyncLocalStorage<number>();

/**
 * Run turn processing with its turn in scope, so entries emitted by its phases
 * resolve their turn without a clock read. The scope only saves the read: the
 * clock already resolves to the same turn while a turn is processing.
 */
export function runWithLedgerTurn<T>(turn: number, work: () => Promise<T>): Promise<T> {
  return processingTurn.run(turn, work);
}

/**
 * The turn a ledger entry emitted now belongs to: the processing turn inside a
 * turn, otherwise one past the clock. Null when there is no clock yet, so the
 * caller keeps the entry's own turn.
 */
export async function resolveLedgerTurn(db: Db): Promise<number | null> {
  const scoped = processingTurn.getStore();
  if (scoped !== undefined) return scoped;
  const state = await db
    .collection<{ _id: string; currentTurn?: number }>("gameState")
    .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
  const clock = state?.currentTurn;
  return typeof clock === "number" && Number.isInteger(clock) ? ledgerTurnFromClock(clock) : null;
}
