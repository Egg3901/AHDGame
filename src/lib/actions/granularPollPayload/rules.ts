/**
 * Candidate approval in granular polls. Archetype approval is projected into
 * demographic buckets and modifies appeal through the election engine's
 * favorability calculation; see applyCandidateApprovalWeight.
 */
import { projectArchetypeValuesToBuckets } from "@/lib/demographics/archetypeBucketMap";
import { calcEffectiveFavorability } from "@/lib/electionEngine/voteCalculations";
import { approvalScalar } from "@/lib/utils/demographicAppeal";
import { normalizeNPI } from "@/lib/utils/normalizeNPI";
import { applyVoteReachFloor } from "@/lib/electionEngine/electionFormulaFactors";

/** Project authoritative archetype approvals into the active country's cell vocabulary. */
export function projectCandidateApprovalBuckets(
  archetypeApprovals: Record<string, number> | undefined,
  countryId: string
): Record<string, number> {
  return projectArchetypeValuesToBuckets(archetypeApprovals ?? {}, countryId);
}

/** Apply the vote engine's effective-favorability and approval kernels to a cell. */
export function applyCandidateApprovalWeight(
  appeal: number,
  favorability: number | undefined,
  approvalBuckets: Record<string, number>,
  cellBuckets: Record<string, string>
): number {
  const archetypeApproval = Object.entries(cellBuckets).reduce(
    (sum, [dimension, bucket]) => sum + (approvalBuckets[`${dimension}:${bucket}`] ?? 0),
    0
  );
  const effectiveFavorability = calcEffectiveFavorability(favorability ?? 50, archetypeApproval);
  return appeal * approvalScalar(effectiveFavorability);
}

/** Apply the tally's tenure-adjusted approval and reach to a poll cell. */
export function applyCandidatePersonalVoteWeight(
  appeal: number,
  favorability: number | undefined,
  influence: number | undefined,
  tenureRetention: number,
  approvalBuckets: Record<string, number>,
  cellBuckets: Record<string, string>
): number {
  return (
    applyCandidateApprovalWeight(
      appeal,
      Math.max(0, (favorability ?? 50) * tenureRetention),
      approvalBuckets,
      cellBuckets
    ) * applyVoteReachFloor(normalizeNPI(Math.max(0, (influence ?? 0) * tenureRetention)))
  );
}
