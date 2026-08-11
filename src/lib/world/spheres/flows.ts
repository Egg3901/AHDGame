import { clampNonNegative, clampShare } from "./bounds";
import { resolvePrimarySponsor } from "./relationships";
import type { SphereBounds, SphereFlow, SphereMembership, SphereRelationship } from "./types";

/**
 * Base ₳ scale for treaty flows. Multiplied by alignment × integration and
 * then clamped by configured per-kind and per-entity caps.
 */
const FLOW_BASE_AID = 80;
const FLOW_BASE_TRIBUTE = 35;
const FLOW_BASE_SUPPORT = 45;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function activeTreaty(rel: SphereRelationship): boolean {
  return rel.treatyState === "active";
}

/**
 * Deterministic aid / tribute / support schedule for one membership.
 *
 * - Aid: sponsor → member (primary preferred; secondary only when treaty active)
 * - Tribute: member → sponsor (integration-weighted; secondary discounted)
 * - Support: sponsor → member military/development (primary + active treaty only)
 *
 * Caps from {@link SphereBounds} prevent duplicate-full and runaway totals.
 */
export function computeSphereFlows(
  membership: SphereMembership,
  bounds: SphereBounds
): SphereFlow[] {
  const primaryId = resolvePrimarySponsor(membership);
  const flows: SphereFlow[] = [];
  let remainingTotal = clampNonNegative(bounds.maxTotalFlowsPerEntityPerTurn);

  const take = (requested: number, cap: number): number => {
    const allowed = Math.min(clampNonNegative(requested), clampNonNegative(cap), remainingTotal);
    const amount = roundMoney(allowed);
    remainingTotal = roundMoney(remainingTotal - amount);
    return amount;
  };

  for (const rel of membership.relationships) {
    if (remainingTotal <= 0) break;
    if (!activeTreaty(rel) && rel.sponsorId !== primaryId) continue;

    const isPrimary = primaryId != null && rel.sponsorId === primaryId;
    const weight = clampShare(rel.alignment) * clampShare(rel.integration);
    if (weight <= 0) continue;

    // Secondary relationships without an active treaty never generate flows.
    if (!isPrimary && !activeTreaty(rel)) continue;

    const secondaryDiscount = isPrimary ? 1 : 0.35;

    if (activeTreaty(rel) || isPrimary) {
      const rawAid = FLOW_BASE_AID * weight * secondaryDiscount * (isPrimary ? 1 : 0.5);
      const aid = take(rawAid, bounds.maxAidPerTurn);
      if (aid > 0) {
        flows.push({
          kind: "aid",
          fromEntityId: rel.sponsorId,
          toEntityId: membership.entityId,
          amount: aid,
          sponsorId: rel.sponsorId,
          memberId: membership.entityId,
          reason: isPrimary
            ? `Primary-sphere aid from ${rel.sponsorId} (alignment×integration=${weight.toFixed(3)})`
            : `Secondary-sphere aid from ${rel.sponsorId} (bounded ${secondaryDiscount}×)`,
        });
      }
    }

    if (remainingTotal <= 0) break;

    if (activeTreaty(rel)) {
      const rawTribute = FLOW_BASE_TRIBUTE * weight * secondaryDiscount * (isPrimary ? 0.85 : 0.4);
      const tribute = take(rawTribute, bounds.maxTributePerTurn);
      if (tribute > 0) {
        flows.push({
          kind: "tribute",
          fromEntityId: membership.entityId,
          toEntityId: rel.sponsorId,
          amount: tribute,
          sponsorId: rel.sponsorId,
          memberId: membership.entityId,
          reason: `Treaty tribute to ${rel.sponsorId} under ${rel.treatyIds.join(",") || "active treaty"}`,
        });
      }
    }

    if (remainingTotal <= 0) break;

    if (isPrimary && activeTreaty(rel)) {
      const rawSupport = FLOW_BASE_SUPPORT * weight;
      const support = take(rawSupport, bounds.maxSupportPerTurn);
      if (support > 0) {
        flows.push({
          kind: "support",
          fromEntityId: rel.sponsorId,
          toEntityId: membership.entityId,
          amount: support,
          sponsorId: rel.sponsorId,
          memberId: membership.entityId,
          reason: `Primary-sphere military/development support from ${rel.sponsorId}`,
        });
      }
    }
  }

  return flows;
}
