import type { NPP } from "@/lib/db/types";
import { calculateRecruitmentSlots } from "./recruitment";

export interface MergeNppCullResult {
  /** Incoming NPPs that fit under the surviving party's per-state cap. */
  keep: NPP[];
  /** Incoming NPPs that exceed the cap and must be removed. */
  cull: NPP[];
}

/**
 * Decide which of the merged-from (defunct) party's active NPPs survive a party
 * merge and which exceed the surviving party's per-state recruitment cap.
 *
 * The merged-into party keeps ALL of its own NPPs — callers pass their per-state
 * active counts via `targetActiveCountByState`, and those consume slots first.
 * Each state's remaining slots are then filled by the strongest incoming NPPs
 * (politicalInfluence desc, then favorability desc, then a stable id ordering so
 * the result never depends on input order); any NPP beyond the cap is culled.
 *
 * Cap basis: `targetOrgByState` is the surviving party's POST-merge state
 * organization (after the +50% org transfer that the merge performs), so the cap
 * reflects the merged entity's real organizational capacity — matching the slot
 * math a fresh recruit would face (`calculateRecruitmentSlots`).
 */
export function selectMergeNppCull(params: {
  proposingNpps: NPP[];
  targetActiveCountByState: Map<string, number>;
  targetOrgByState: Map<string, number>;
}): MergeNppCullResult {
  const { proposingNpps, targetActiveCountByState, targetOrgByState } = params;

  // Group incoming NPPs by home state — the cap is enforced per state.
  const byState = new Map<string, NPP[]>();
  for (const npp of proposingNpps) {
    const list = byState.get(npp.homeState);
    if (list) list.push(npp);
    else byState.set(npp.homeState, [npp]);
  }

  const keep: NPP[] = [];
  const cull: NPP[] = [];

  for (const [stateId, npps] of byState) {
    const maxSlots = calculateRecruitmentSlots(targetOrgByState.get(stateId) ?? 0);
    const targetCount = targetActiveCountByState.get(stateId) ?? 0;
    const remaining = Math.max(0, maxSlots - targetCount);

    const ranked = [...npps].sort(compareNppStrength);
    keep.push(...ranked.slice(0, remaining));
    cull.push(...ranked.slice(remaining));
  }

  return { keep, cull };
}

/** Strongest-first ordering with a deterministic final tiebreak. */
function compareNppStrength(a: NPP, b: NPP): number {
  if (b.politicalInfluence !== a.politicalInfluence) {
    return b.politicalInfluence - a.politicalInfluence;
  }
  if (b.favorability !== a.favorability) {
    return b.favorability - a.favorability;
  }
  return a._id.toString().localeCompare(b._id.toString());
}
