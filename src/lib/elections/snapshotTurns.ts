/**
 * Turns counted so far. A turn may hold two snapshots (the half-hour results
 * tick's early half and the turn's rest), so the snapshot count overstates it.
 */
export function countedTurns(snapshots: readonly { turn: number }[] | undefined): number {
  return new Set((snapshots ?? []).map((snapshot) => snapshot.turn)).size;
}
