import { describe, expect, it } from "vitest";
import type { LegislationType } from "@/lib/db/types";
import { legislationTypes } from "./legislationTypes";
import { deLegislationTypes } from "../de/deLegislationTypes";
import { cnLegislationTypes } from "../cn/cnLegislationTypes";
import { ieLegislationTypes } from "../ie/ieLegislationTypes";
import { jpLegislationTypes } from "../jp/jpLegislationTypes";

/**
 * §4.7 governance/media sweep guard (P4). This tier has NO spending channel —
 * the double-count dimension is ROOT-vs-READOUT pass-through: a law targeting
 * BOTH a policy root and one of its engine-derived readouts counts the same
 * mechanism twice (the engine already derives the readout from the root).
 *
 *   pressFreedom (root) → newsTrust, disinformationRisk
 *   governmentTransparency (root) → corruptionIndex
 *
 * Laws targeting a READOUT alone are fine (coexistence deltas are the policy
 * channel for 🔧-flavored readouts like mediaPolarization). KEEP-LIST = pinned
 * per-law allowed pairs for justified distinct mechanisms.
 */
// DIRECT engine edges only (gain ≥ 0.25). Weak chain hops (transparency →
// corruption → publicTrust ≈ 0.125; press → news → bbcTrust) are NOT flagged —
// a law's publicTrust/bbcTrust secondary is usually its own distinct trust
// mechanism (rally, institution), acknowledged + named for the balance pass.
const ROOT_TO_READOUTS: Array<[string, string, Set<string>]> = [
  ["mediaInformation", "pressFreedom", new Set(["newsTrust", "disinformationRisk"])],
  ["governance", "governmentTransparency", new Set(["corruptionIndex"])],
];

const MECHANISM_KEEP_LIST = new Map<string, Set<string>>([
  // (no entries — every direct pair resolved by dropping the pass-through side)
]);

function lawTargets(lt: LegislationType): Array<{ cat: string; id: string }> {
  const out: Array<{ cat: string; id: string }> = [];
  if (lt.effectTarget) {
    out.push({ cat: lt.effectTarget.metricCategoryId, id: lt.effectTarget.metricId });
  }
  for (const w of lt.effectTargetsWeighted ?? []) {
    out.push({ cat: w.metricCategoryId, id: w.metricId });
  }
  for (const opt of lt.policyOptions ?? []) {
    for (const e of opt.metricEffects ?? []) out.push({ cat: e.category, id: e.metricId });
  }
  return out;
}

describe("§4.7 governance/media root-vs-readout sweep", () => {
  const all = [
    ...legislationTypes,
    ...deLegislationTypes,
    ...cnLegislationTypes,
    ...ieLegislationTypes,
    ...jpLegislationTypes,
  ];

  it("no law targets BOTH a root and its engine-derived readout", () => {
    const offenders: string[] = [];
    for (const lt of all) {
      const targets = lawTargets(lt);
      const allowed = MECHANISM_KEEP_LIST.get(lt._id);
      for (const [cat, root, readouts] of ROOT_TO_READOUTS) {
        const hasRoot = targets.some((t) => t.cat === cat && t.id === root);
        if (!hasRoot) continue;
        for (const t of targets) {
          if (readouts.has(t.id) && !allowed?.has(t.id)) {
            offenders.push(`${lt._id} → ${root} + ${t.id}`);
          }
        }
      }
    }
    expect(offenders, `root+readout pass-throughs:\n${offenders.join("\n")}`).toEqual([]);
  });
});
