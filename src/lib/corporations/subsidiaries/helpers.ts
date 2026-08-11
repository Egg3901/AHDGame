import type { ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { getControllingCorporateParent } from "@/lib/corporations/corporateOwnership";

/**
 * True iff this corp is a *managed* subsidiary right now: some corporation still
 * controls >50% of its voting power AND the relationship has been formalized.
 * The relationship itself is always derived — `subsidiaryFormalizedAtTurn` is
 * only an opt-in marker, never a stored parent pointer.
 */
export function isFormalizedSubsidiary(
  corp: Pick<Corporation, "subsidiaryFormalizedAtTurn">,
  controllingParent: { corporationId: ObjectId } | null
): boolean {
  return controllingParent != null && corp.subsidiaryFormalizedAtTurn != null;
}

/**
 * The parent-set dividend floor (percent) that is currently ACTIVE for a corp:
 * the stored `parentDividendFloorPct` clamped to `maxRate`, but only while the
 * feature is on AND the corp that set it still controls >50% voting power.
 * Otherwise 0 (ignored). Shared by the turn dividend site and the detail mirror.
 */
export function activeParentDividendFloorPct(params: {
  enabled: boolean;
  parentDividendFloorPct?: number;
  parentDividendFloorSetByCorpId?: ObjectId;
  controllingParent: { corporationId: ObjectId } | null;
  maxRate: number;
}): number {
  const {
    enabled,
    parentDividendFloorPct,
    parentDividendFloorSetByCorpId,
    controllingParent,
    maxRate,
  } = params;
  if (!enabled) return 0;
  if (parentDividendFloorPct == null || parentDividendFloorSetByCorpId == null) return 0;
  if (!controllingParent) return 0;
  if (!controllingParent.corporationId.equals(parentDividendFloorSetByCorpId)) return 0;
  return Math.max(0, Math.min(maxRate, parentDividendFloorPct));
}

/**
 * A corp may act as a subsidiary PARENT only if it is not a national/state-owned
 * corp and is not itself a formalized subsidiary (no chaining). The formalization
 * marker is the derived-model proxy for "is itself a managed subsidiary".
 */
export function isEligibleAsSubsidiaryParent(
  corp: Pick<Corporation, "countryOwnerId" | "subsidiaryFormalizedAtTurn">
): boolean {
  if (corp.countryOwnerId) return false;
  if (corp.subsidiaryFormalizedAtTurn != null) return false;
  return true;
}

/** A corp may be held as a subsidiary only if it is not a national/state-owned corp. */
export function isEligibleAsSubsidiary(corp: Pick<Corporation, "countryOwnerId">): boolean {
  return !corp.countryOwnerId;
}

/**
 * Would making `parent` control `target` create an ownership cycle?
 *
 * Control edges are derived live: for every corp `c`, `getControllingCorporateParent(c)`
 * yields the corp that controls it (>50% voting). Adding a `parent → target` edge
 * introduces a cycle iff `target` already controls `parent` transitively (i.e.
 * `parent` is reachable descending from `target` through existing control edges),
 * or `parent === target`.
 */
export function wouldCreateOwnershipCycle(
  parent: Pick<Corporation, "_id">,
  target: Pick<Corporation, "_id">,
  allCorps: Corporation[]
): boolean {
  if (parent._id.equals(target._id)) return true;

  // childrenByParent: controllerId → corps it currently controls (>50% voting).
  const childrenByParent = new Map<string, ObjectId[]>();
  for (const corp of allCorps) {
    const controller = getControllingCorporateParent(corp);
    if (!controller) continue;
    const key = controller.corporationId.toString();
    const list = childrenByParent.get(key) ?? [];
    list.push(corp._id);
    childrenByParent.set(key, list);
  }

  // Descend from `target`: if we can reach `parent`, target already controls it.
  const parentKey = parent._id.toString();
  const seen = new Set<string>();
  const stack = [target._id.toString()];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const children = childrenByParent.get(current);
    if (!children) continue;
    for (const childId of children) {
      const childKey = childId.toString();
      if (childKey === parentKey) return true;
      stack.push(childKey);
    }
  }
  return false;
}

/**
 * One-person rule: a subsidiary must be operated by a different human than the
 * parent's owner, the parent's sitting CEO, or the operator of any sibling
 * subsidiary of the same parent. Keys on the human behind the CEO seat — never
 * on `corp.userId` of the subsidiary itself.
 */
export function humanBlockedFromSubsidiaryCeo(params: {
  candidateUserId: ObjectId;
  parentOwnerUserId: ObjectId;
  parentCeoUserId: ObjectId;
  siblingSubsidiaryCeoUserIds: ObjectId[];
}): boolean {
  const { candidateUserId, parentOwnerUserId, parentCeoUserId, siblingSubsidiaryCeoUserIds } =
    params;
  if (candidateUserId.equals(parentOwnerUserId)) return true;
  if (candidateUserId.equals(parentCeoUserId)) return true;
  return siblingSubsidiaryCeoUserIds.some((uid) => candidateUserId.equals(uid));
}
