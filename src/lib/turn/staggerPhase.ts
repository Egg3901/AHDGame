/**
 * Fixed phase of a periodic job for one subject, in [0, period). Periodic
 * work that every subject used to run on the same turn (all index funds
 * rebalancing on the day boundary, every NPP investing on the same turn of
 * four) runs for a subject when `currentTurn % period` equals its phase, so
 * each turn carries an even share instead of one turn carrying all of it.
 * FNV-1a over the id: stable across processes and restarts.
 */
export function staggerPhase(id: string, period: number): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % period;
}

/** Whether `currentTurn` is this subject's turn of the period. */
export function isStaggeredTurn(id: string, currentTurn: number, period: number): boolean {
  return currentTurn > 0 && staggerPhase(id, period) === currentTurn % period;
}
