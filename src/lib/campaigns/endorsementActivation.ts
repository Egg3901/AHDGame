/**
 * Endorsement activation for the presidential general engine (rework).
 *
 * Two channels, both wired here but held at identity (magnitude 0) until they
 * are calibrated against the live cycle:
 *
 *   1. Org boost — an active endorser lends a fraction of their per-state ground
 *      org to the endorsed candidate's effective org in the vote distribution.
 *   2. Coalition credibility — a candidate's votes carry a small multiplier that
 *      grows with the number of active endorsements they hold.
 *
 * Both helpers are pure and return exact no-ops at magnitude 0 (fraction /
 * credibility <= 0), so a v1/v2 race — or v3 before calibration — is byte
 * identical to today. Only a positive ruleset knob activates them.
 */

/** An active endorsement expressed as an org-lending link between candidate rows. */
export interface EndorsementOrgLink {
  /** Endorser's election-candidate row id (the org donor). */
  endorserCandidateId: string;
  /** Endorsed election-candidate row id (the org recipient). */
  endorsedCandidateId: string;
}

/**
 * Add `endorserOrg * orgFraction` (floored, positive only) from each endorser to
 * their endorsee's per-state org. Mutates `stateOrgByStateAndCandidate` in place.
 * Exact no-op when `orgFraction <= 0` or there are no links — no map key is
 * created, so identity behavior is preserved to the byte.
 */
export function applyEndorsementOrgBoosts(
  stateOrgByStateAndCandidate: Map<string, Map<string, number>>,
  links: EndorsementOrgLink[],
  orgFraction: number
): void {
  if (orgFraction <= 0 || links.length === 0) return;
  for (const stateMap of stateOrgByStateAndCandidate.values()) {
    for (const link of links) {
      const endorserOrg = stateMap.get(link.endorserCandidateId);
      if (!endorserOrg || endorserOrg <= 0) continue;
      const boost = Math.floor(endorserOrg * orgFraction);
      if (boost <= 0) continue;
      stateMap.set(link.endorsedCandidateId, (stateMap.get(link.endorsedCandidateId) ?? 0) + boost);
    }
  }
}

/**
 * Coalition-credibility vote multiplier for a candidate: `1 + count * credibility`.
 * Returns exactly `1` when `credibility <= 0` or the candidate holds no
 * endorsements, so at identity the multiply is a no-op.
 */
export function endorsementCredibilityMultiplier(
  endorsementCount: number,
  credibility: number
): number {
  if (credibility <= 0 || endorsementCount <= 0) return 1;
  return 1 + endorsementCount * credibility;
}
