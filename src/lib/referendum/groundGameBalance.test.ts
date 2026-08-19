import { describe, it, expect } from "vitest";
import { buildReferendumCohorts, aggregateYesShare, type CohortModifier } from "./cohortEngine";
import { applyPresetToModifiers } from "./applyPresetToModifiers";
import { findGroundGamePreset } from "@/lib/constants/groundGamePresets";
import { cohortAffinitiesFor } from "@/lib/constants/referendumCohorts";
import { getBucketProfileForRegion } from "@/lib/demographics/bucketProfile";

// Balance contract for the referendum ground game — drives the real engine over
// the real NIR electorate so a future tune can't silently regress the
// signed-off numbers (design 2026-06-18-ground-game-rebalance §9). Bounds are
// intentionally loose: they pin behavior (label-accuracy, mobilize works + is
// side-flipped, no landslide single action, contested cancels), not exact
// magnitudes.
//
// The fixture was a hand-copied archetype table; it now reads NIR's Layer-1
// bucket profile straight from the substrate, which is both the real structure
// and the one the vote engine counts, so the contract cannot drift away from
// the electorate it claims to describe.
const NIR = getBucketProfileForRegion("UK", "NIR", "2019-default")!;
const base = buildReferendumCohorts(NIR, 50, cohortAffinitiesFor("NIR"));
const ys = (m: CohortModifier[]) => aggregateYesShare(base, m, 0);
const open = ys([]);
const big = [...base].sort((a, b) => b.share - a.share)[0].groupId;
const p = (id: string) => findGroundGamePreset(id)!;

describe("ground-game balance contract (NIR, desire 50)", () => {
  it("opens at ~50", () => expect(open).toBeCloseTo(50, 1));

  it("whole persuade == card label", () => {
    expect(
      ys(applyPresetToModifiers(base, [], p("broadcast_ads"), "yes", "whole")) - open
    ).toBeCloseTo(1.5, 1);
    expect(
      ys(applyPresetToModifiers(base, [], p("press_conference"), "yes", "whole")) - open
    ).toBeCloseTo(0.5, 1);
  });

  it("mobilize whole is meaningful and side-flipped", () => {
    const up = ys(applyPresetToModifiers(base, [], p("mass_rally"), "yes", "whole")) - open;
    const down = ys(applyPresetToModifiers(base, [], p("mass_rally"), "no", "whole")) - open;
    expect(up).toBeGreaterThan(2.7);
    expect(up).toBeLessThan(3.4);
    expect(down).toBeLessThan(-2.7);
  });

  // BALANCE CHANGE, deliberate and flagged. A targeted broadcast's aggregate
  // effect is bounded by the target's share of the electorate (see
  // `applyPresetToModifiers`), and bucket cohorts are roughly four times finer
  // than the archetype cohorts they replace — NIR's largest is now
  // `income:middle` at ~13% where `post_industrial_workers` was 28%. So the
  // same card moves ~1.1 points where it used to move ~2.3. Targeting is now a
  // sharper instrument with a smaller aggregate payoff, which is coherent, but
  // it is a nerf to a player-facing action. The lever to restore the old feel
  // is `GG_PERSUADE_TARGET_CONC`, not this bound.
  it("targeted broadcast is about a point, not a landslide", () => {
    const d =
      ys(applyPresetToModifiers(base, [], p("broadcast_ads"), "yes", { groupId: big })) - open;
    expect(d).toBeGreaterThan(0.9);
    expect(d).toBeLessThan(1.4);
  });

  it("contested persuade cancels at volume", () => {
    let m: CohortModifier[] = [];
    for (let i = 0; i < 6; i++)
      m = applyPresetToModifiers(base, m, p("broadcast_ads"), "yes", "whole");
    for (let i = 0; i < 6; i++)
      m = applyPresetToModifiers(base, m, p("broadcast_ads"), "no", "whole");
    expect(ys(m)).toBeCloseTo(open, 4);
  });
});
