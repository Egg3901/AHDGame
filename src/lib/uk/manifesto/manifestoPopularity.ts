import { calcAppeal, MAX_APPEAL } from "@/lib/utils/demographicAppeal";
import type {
  ManifestoDeliveryResult,
  PledgeCatalogEntry,
  PledgeTargetSemantics,
} from "@/lib/db/types/manifesto";

/**
 * Manifesto policy-popularity scoring (UK rework, epic #856).
 *
 * Two pure halves:
 *   1. Campaign popularity → a per-demographic-group vote-share multiplier.
 *   2. Delivery (kept/broken) → a meter from enacted laws.
 *
 * Both are pure and side-effect free so they can be unit-tested and reused by
 * the vote model, polling, and the confidence gauge without a DB.
 *
 * The vote-share multiplier is deliberately bounded and defaults small; the
 * caller supplies `maxSwing`. Design decision: MEDIUM (~5-7%) — validate the
 * exact value in worldsim before enabling in live elections. See ops-knowledge
 * `uk-rework-design-2026-08-25`.
 */

/** Default maximum fractional vote-share swing a manifesto can apply per group. */
export const DEFAULT_MANIFESTO_MAX_SWING = 0.06;

export interface GroupLean {
  economicLean: number;
  socialLean: number;
}

export interface ManifestoScoreOptions {
  /** Max fractional swing (e.g. 0.06 = ±6%). */
  maxSwing?: number;
}

/**
 * Salience for a pledge within a specific demographic group.
 * Falls back to the entry's baseSalience. Clamped to [0, 1].
 */
export function pledgeSalienceForGroup(entry: PledgeCatalogEntry, groupId: string): number {
  const raw = entry.salienceByGroup?.[groupId];
  const s = typeof raw === "number" ? raw : entry.baseSalience;
  return Math.max(0, Math.min(1, s));
}

/**
 * Signed popularity of a single pledge with one group, in [-salience, +salience].
 * Positive = the pledge pleases this group, negative = it repels them.
 *
 * `calcAppeal` returns higher for positions closer to the group mean. We
 * normalise it to [0,1] against MAX_APPEAL and centre it so that a perfectly
 * neutral fit contributes 0. Influence is excluded (a pledge has no candidate
 * name-recognition of its own).
 */
export function pledgePopularityForGroup(
  entry: PledgeCatalogEntry,
  group: GroupLean,
  groupId: string
): number {
  const appeal = calcAppeal(
    group.economicLean,
    group.socialLean,
    entry.position.economic,
    entry.position.social,
    0,
    false
  );
  // Normalise against the position-only ceiling. calcAppeal with influence off
  // maxes at 25 (position) + up to 10 (direction bonus); MAX_APPEAL/2 = 25 is a
  // stable, documented reference that keeps this in a sane range.
  const appealNorm = Math.max(0, Math.min(1, appeal / (MAX_APPEAL / 2)));
  // Centre: 0.5 fit → 0 contribution; closer → positive, further → negative.
  const centred = 2 * appealNorm - 1;
  return pledgeSalienceForGroup(entry, groupId) * centred;
}

/**
 * Per-group vote-share multiplier for a whole manifesto, centred on 1.0.
 * Averages the signed popularity of the pledges (so more pledges ≠ bigger swing)
 * and scales into ±maxSwing.
 */
export function manifestoMultiplierForGroup(
  pledges: PledgeCatalogEntry[],
  group: GroupLean,
  groupId: string,
  opts: ManifestoScoreOptions = {}
): number {
  if (pledges.length === 0) return 1;
  const maxSwing = opts.maxSwing ?? DEFAULT_MANIFESTO_MAX_SWING;
  let sum = 0;
  for (const p of pledges) sum += pledgePopularityForGroup(p, group, groupId);
  const avg = sum / pledges.length; // already in [-1, 1]
  const clamped = Math.max(-1, Math.min(1, avg));
  return 1 + maxSwing * clamped;
}

/**
 * Active policy at judgment time. Option-based laws record `policyOptionId`;
 * UK level-based ("primary") laws record `policyOptionIndex`.
 */
export type EnactedPolicyLookup = Record<
  string,
  { policyOptionId?: string; policyOptionIndex?: number; effectDirection?: number } | undefined
>;

export interface PledgeTargetLike {
  legislationTypeId: string;
  policyOptionId?: string;
  policyOptionLevel?: number;
}

/**
 * Is a single pledge kept, given the currently-active policies? Handles both
 * option-based and level-based (UK) laws.
 *
 * enact:
 *  - option: kept iff a mapped option is the active option.
 *  - level:  kept iff the active level is >= the pledged floor.
 * maintain:
 *  - level:  kept unless the active level fell below the pledged floor.
 *  - option: kept unless the active policy moved AGAINST the pledged direction
 *            (a cut / reversal). No active record = kept (nothing changed it).
 */
export function isPledgeKept(
  targets: PledgeTargetLike[],
  semantics: PledgeTargetSemantics,
  enacted: EnactedPolicyLookup,
  targetDirections?: Record<string, number>
): { kept: boolean; reason: string } {
  if (targets.length === 0) return { kept: false, reason: "no targets mapped" };

  if (semantics === "enact") {
    for (const t of targets) {
      const active = enacted[t.legislationTypeId];
      if (!active) continue;
      if (t.policyOptionId !== undefined && active.policyOptionId === t.policyOptionId) {
        return { kept: true, reason: `enacted ${t.policyOptionId}` };
      }
      if (
        t.policyOptionLevel !== undefined &&
        active.policyOptionIndex !== undefined &&
        active.policyOptionIndex >= t.policyOptionLevel
      ) {
        return { kept: true, reason: `reached level ${active.policyOptionIndex}` };
      }
    }
    return { kept: false, reason: "pledged target not reached" };
  }

  // maintain
  for (const t of targets) {
    const active = enacted[t.legislationTypeId];
    if (!active) continue; // untouched → fine

    if (t.policyOptionLevel !== undefined && active.policyOptionIndex !== undefined) {
      if (active.policyOptionIndex < t.policyOptionLevel) {
        return { kept: false, reason: `level fell to ${active.policyOptionIndex}` };
      }
      continue;
    }

    if (t.policyOptionId !== undefined) {
      if (active.policyOptionId === undefined) continue; // untouched
      if (active.policyOptionId === t.policyOptionId) continue; // still at baseline
      const wanted = targetDirections?.[t.legislationTypeId];
      const got = active.effectDirection;
      if (typeof wanted === "number" && typeof got === "number") {
        if (Math.sign(got) !== 0 && Math.sign(got) === -Math.sign(wanted)) {
          return { kept: false, reason: `policy moved against pledge on ${t.legislationTypeId}` };
        }
      }
    }
  }
  return { kept: true, reason: "maintained" };
}

/**
 * Judge a locked manifesto's delivery. Only meaningful for the governing
 * party/coalition (callers gate on who actually held power).
 */
export function evaluateDelivery(
  pledges: {
    catalogEntryId: string;
    targets: PledgeTargetLike[];
    targetSemantics: PledgeTargetSemantics;
    targetDirections?: Record<string, number>;
  }[],
  enacted: EnactedPolicyLookup
): ManifestoDeliveryResult {
  const perPledge = pledges.map((p) => {
    const r = isPledgeKept(p.targets, p.targetSemantics, enacted, p.targetDirections);
    return { catalogEntryId: p.catalogEntryId, kept: r.kept, reason: r.reason };
  });
  const kept = perPledge.filter((p) => p.kept).length;
  const total = perPledge.length;
  return {
    total,
    kept,
    broken: total - kept,
    meter: total === 0 ? 0 : kept / total,
    perPledge,
  };
}
