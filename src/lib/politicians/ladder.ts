/**
 * NPI rank-ladder scaling (locked composite): every row's influence bar is
 * scaled to the current result set's #1, so the list reads as a leaderboard.
 */
export function ladderWidthPct(npi: number, maxNpi: number): number {
  if (!maxNpi || maxNpi <= 0) return 0;
  return Math.max(0, Math.min(100, (npi / maxNpi) * 100));
}
