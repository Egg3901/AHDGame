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
