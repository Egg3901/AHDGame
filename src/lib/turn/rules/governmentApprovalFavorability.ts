/** Maximum ruling-party favorability loss per turn, reached at 0 approval. */
export const MAX_GOVERNMENT_APPROVAL_FAVORABILITY_DRAIN = 0.25;

/** Return the below-neutral accountability cost for a ruling-party member. */
export function governmentApprovalFavorabilityDrain(approval: number): number {
  if (!Number.isFinite(approval) || approval >= 50) return 0;
  return Math.min(MAX_GOVERNMENT_APPROVAL_FAVORABILITY_DRAIN, (50 - Math.max(0, approval)) / 200);
}
