/**
 * Frozen result of a single legislature voting phase, captured at the moment the
 * phase closes. Non-destructive: the raw vote map is preserved separately. Display
 * surfaces use this in place of live re-scoping so a concluded bill's tally cannot
 * be recomputed against a post-election chamber (#0982).
 */
export interface BillVoteSnapshot {
  /** Scoped survivor vote map as of phase close (subset of the raw votes map). */
  votes: Record<string, "for" | "against" | "abstain">;
  /** voterKey → seat weight applied at close (serialized from the scope weightMap). */
  weights: Record<string, number>;
  /** Seat-weighted totals over `votes`. */
  totals: { for: number; against: number; abstain: number };
  /** Game-clock turn the phase closed on. */
  resolvedAtTurn: number;
}
