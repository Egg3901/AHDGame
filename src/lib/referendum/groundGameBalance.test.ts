import { describe, it, expect } from "vitest";
import { buildReferendumCohorts, aggregateYesShare, type CohortModifier } from "./cohortEngine";
import { applyPresetToModifiers } from "./applyPresetToModifiers";
import { findGroundGamePreset } from "@/lib/constants/groundGamePresets";
import { cohortAffinitiesFor } from "@/lib/constants/referendumCohorts";

// Balance contract for the referendum ground game — drives the real engine over
// the real NIR demographic structure (shares/turnouts from the live dev
// referendum) so a future tune can't silently regress the signed-off numbers
// (design 2026-06-18-ground-game-rebalance §9). Bounds are intentionally loose:
// they pin behavior (label-accuracy, mobilize works + is side-flipped, no
// landslide single action, contested cancels), not exact magnitudes.
const NIR = {
  post_industrial_workers: { population: 280, turnout: 58, economicLean: 0, socialLean: 0 },
  urban_progressives: { population: 80, turnout: 62, economicLean: 0, socialLean: 0 },
  suburban_homeowners: { population: 80, turnout: 62, economicLean: 0, socialLean: 0 },
  young_renters: { population: 80, turnout: 50, economicLean: 0, socialLean: 0 },
  rural_traditionalists: { population: 100, turnout: 65, economicLean: 0, socialLean: 0 },
  retirees: { population: 70, turnout: 68, economicLean: 0, socialLean: 0 },
  public_sector: { population: 70, turnout: 65, economicLean: 0, socialLean: 0 },
  moderate_centrists: { population: 150, turnout: 64, economicLean: 0, socialLean: 0 },
  populist_right: { population: 70, turnout: 63, economicLean: 0, socialLean: 0 },
  green_activists: { population: 0, turnout: 58, economicLean: 0, socialLean: 0 },
  small_business: { population: 20, turnout: 62, economicLean: 0, socialLean: 0 },
  new_britons: { population: 0, turnout: 44, economicLean: 0, socialLean: 0 },
};
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

  it("targeted broadcast is a couple of points, not a landslide", () => {
    const d =
      ys(applyPresetToModifiers(base, [], p("broadcast_ads"), "yes", { groupId: big })) - open;
    expect(d).toBeGreaterThan(2);
    expect(d).toBeLessThan(2.6);
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
