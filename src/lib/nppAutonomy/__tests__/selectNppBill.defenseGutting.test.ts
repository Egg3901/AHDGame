/**
 * Regression for the "Skeleton Force" incident (t650 sandbox run, ahd_sim_grand53fx):
 * the autonomous NPP bill-selection AI repealed the United States' Armed Forces
 * Establishment Act (Mobilized Establishment, 7.56% of GDP) and Defense
 * Production and Research Act (Research and Production Drive, 1.51% of GDP)
 * within about a year of the 1953 start, replacing both with $0-cost options
 * named "Skeleton Force" and "No Defense Industry Policy" — deleting roughly a
 * third of the federal budget. Verified against the sandbox DB: the sponsoring
 * NPP (Ethan Werner Sr.) carried policies.economic: 0.1, policies.social: 0 —
 * i.e. essentially no ideological lean at all.
 *
 * Root cause: platformFitForOption normalized away option magnitude (dividing
 * by the option vector's own hypot), so on a domain like defense — where every
 * policy option carries economic: 0 and only social varies — any NPP with no
 * social lean scored *every* option in the ladder identically. The
 * deterministic first-wins tie-break in bestPlatformFit then always picked
 * whichever option was seeded earliest in the array — which for a
 * weakest-to-strongest ladder is the "abolish it" extreme (l0).
 *
 * This file locks in the fixed behavior with the "gravity, not rails" pair:
 * a neutral/near-neutral NPP in a 1953-US-shaped position must NOT default to
 * gutting defense, but a genuinely pacifist/neutral-bloc NPP (a strong,
 * real dovish lean — the Austria/Ireland case) must still be able to.
 */
import { describe, expect, it } from "vitest";
import type { LegislationPolicyOption, LegislationType, NPP } from "@/lib/db/types";
import { selectNppBill, type ConditionsSignal } from "../selectNppBill";

// The real 5-option armed-forces ladder from us.defense.armedForces.primary
// (ahd_sim_grand53fx legislationTypes), reproduced verbatim: only the social
// axis carries a signal (economic: 0 throughout), ordered weakest → strongest.
function armedForcesLadder(): LegislationType {
  const options: LegislationPolicyOption[] = [
    {
      id: "l0",
      name: "Skeleton Force",
      stance: "left",
      effectDirection: -1,
      economic: 0,
      social: -3,
    },
    {
      id: "l1",
      name: "Peacetime Cadre",
      stance: "left",
      effectDirection: -1,
      economic: 0,
      social: -1.5,
    },
    {
      id: "l2",
      name: "Standing Forces",
      stance: "center",
      effectDirection: 0,
      economic: 0,
      social: 0,
    },
    {
      id: "l3",
      name: "Large Standing Forces",
      stance: "right",
      effectDirection: 1,
      economic: 0,
      social: 1.5,
    },
    {
      id: "l4",
      name: "Mobilized Establishment",
      stance: "right",
      effectDirection: 1,
      economic: 0,
      social: 3,
    },
  ];
  return {
    _id: "us.defense.armedForces.primary",
    name: "Armed Forces Establishment Act",
    description: "",
    policyDomain: "defense",
    subCategory: "",
    positions: [],
    policyOptions: options,
  } as unknown as LegislationType;
}

const noUrgency: ConditionsSignal = { weakDomains: {} };

describe("selectNppBill — defense gutting regression (Skeleton Force incident)", () => {
  it("a near-neutral 1953-US-shaped NPP (economic:0.1, social:0) does not default to Skeleton Force", () => {
    // The exact sponsoring NPP's policy vector from the sandbox DB.
    const npp = { policies: { economic: 0.1, social: 0 } } as NPP;
    const sel = selectNppBill([armedForcesLadder()], npp, noUrgency);

    expect(sel).not.toBeNull();
    expect(sel!.option.id).not.toBe("l0");
    // A neutral NPP should land on (or near) the status-quo/moderate option,
    // not swing to either extreme of the ladder.
    expect(sel!.option.id).toBe("l2");
  });

  it("a mildly dovish NPP (social:-0.5) still does not jump to the zero-cost extreme", () => {
    // Some lean, but nowhere near strong conviction — should still land on a
    // moderate option, not the "abolish it" end.
    const npp = { policies: { economic: 0, social: -0.5 } } as NPP;
    const sel = selectNppBill([armedForcesLadder()], npp, noUrgency);

    expect(sel).not.toBeNull();
    expect(sel!.option.id).not.toBe("l0");
  });

  it("gravity, not rails: a genuinely pacifist/neutral-bloc NPP (strong dovish lean) CAN still gut defense", () => {
    // The Austria/Ireland case: a party whose own ideological position is
    // itself near the ladder's dovish extreme must still be free to pick it.
    const npp = { policies: { economic: 0, social: -4 } } as NPP;
    const sel = selectNppBill([armedForcesLadder()], npp, noUrgency);

    expect(sel).not.toBeNull();
    expect(sel!.option.id).toBe("l0");
  });

  it("gravity, not rails: a genuinely hawkish NPP can still fully mobilize", () => {
    const npp = { policies: { economic: 0, social: 4 } } as NPP;
    const sel = selectNppBill([armedForcesLadder()], npp, noUrgency);

    expect(sel).not.toBeNull();
    expect(sel!.option.id).toBe("l4");
  });
});
