import type { SphereBounds } from "./types";
import type { SphereEffectExplanation, SphereMembership, SphereRoutedContribution } from "./types";

/**
 * Build the world/admin read model that explains why each sphere effect exists:
 * primary designation, market share, treaty posture, and bounded flows.
 */
export function explainSphereEffects(
  membership: SphereMembership,
  routed: SphereRoutedContribution,
  bounds: SphereBounds
): SphereEffectExplanation[] {
  const bySponsor = new Map(routed.allocations.map((a) => [a.sponsorId, a]));
  const flowsBySponsor = new Map<string, SphereRoutedContribution["flows"]>();
  for (const flow of routed.flows) {
    const list = flowsBySponsor.get(flow.sponsorId) ?? [];
    list.push(flow);
    flowsBySponsor.set(flow.sponsorId, list);
  }

  return membership.relationships.map((rel) => {
    const allocation = bySponsor.get(rel.sponsorId);
    const isPrimary = allocation?.isPrimary ?? rel.sponsorId === membership.primarySphereId;
    const marketShare = allocation?.share ?? 0;
    const commodityCount = allocation ? Object.keys(allocation.contribution.byCommodity).length : 0;
    const flows = (flowsBySponsor.get(rel.sponsorId) ?? []).map((flow) => ({
      kind: flow.kind,
      amount: flow.amount,
      direction: `${flow.fromEntityId}→${flow.toEntityId}`,
      reason: flow.reason,
    }));

    const role = isPrimary ? "primary" : "secondary";
    const marketClause =
      marketShare >= 1
        ? "receives the full held market contribution"
        : marketShare > 0
          ? `receives a bounded ${Math.round(marketShare * 100)}% market share`
          : "receives no market contribution (secondary / none)";
    const flowClause =
      flows.length === 0
        ? "no aid/tribute/support this tick"
        : `${flows.length} bounded flow(s) totaling ${flows.reduce((s, f) => s + f.amount, 0).toFixed(2)} ₳`;

    return {
      entityId: membership.entityId,
      sponsorId: rel.sponsorId,
      isPrimary,
      alignment: rel.alignment,
      integration: rel.integration,
      treatyState: rel.treatyState,
      treatyIds: [...rel.treatyIds],
      marketShare,
      marketCommodityCount: commodityCount,
      flows,
      bounds: {
        secondaryMarketShare: bounds.secondaryMarketShare,
        maxAidPerTurn: bounds.maxAidPerTurn,
        maxTributePerTurn: bounds.maxTributePerTurn,
        maxSupportPerTurn: bounds.maxSupportPerTurn,
        maxTotalFlowsPerEntityPerTurn: bounds.maxTotalFlowsPerEntityPerTurn,
      },
      summary: `${membership.entityId}→${rel.sponsorId} (${role}): ${marketClause}; ${flowClause}; treaty=${rel.treatyState}.`,
    };
  });
}
