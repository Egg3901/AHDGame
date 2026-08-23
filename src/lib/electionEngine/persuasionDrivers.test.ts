import { describe, it, expect } from "vitest";
import {
  approvalAdjustedIncumbencyBudget,
  getPersuasionDriverBreakdown,
} from "./persuasionDrivers";
import type { DistributeVotesOptions, EnrichedCandidate } from "./types";

function incPct(pj: string, pi: string, options: DistributeVotesOptions): number {
  const comps = getPersuasionDriverBreakdown(pj, pi, [] as EnrichedCandidate[], options);
  const row = comps.find((c) => c.label === "Incumbency");
  if (!row) throw new Error("no Incumbency row");
  return row.contributionPct;
}

describe("approvalAdjustedIncumbencyBudget", () => {
  // Pivot recalibrated 50→43 (#2899), then 43→46 (ticket 971): shield above 46,
  // drag below, symmetric ±0.10 caps.
  it("ramps +1pp per point above pivot, capping at +0.10 by approval 56", () => {
    expect(approvalAdjustedIncumbencyBudget(46)).toBeCloseTo(0, 6);
    expect(approvalAdjustedIncumbencyBudget(51)).toBeCloseTo(0.05, 6);
    expect(approvalAdjustedIncumbencyBudget(56)).toBeCloseTo(0.1, 6);
    expect(approvalAdjustedIncumbencyBudget(70)).toBeCloseTo(0.1, 6);
    expect(approvalAdjustedIncumbencyBudget(100)).toBeCloseTo(0.1, 6);
  });

  it("ramps -1pp per point below pivot, capping at -0.10 by approval 36", () => {
    expect(approvalAdjustedIncumbencyBudget(41)).toBeCloseTo(-0.05, 6);
    expect(approvalAdjustedIncumbencyBudget(36)).toBeCloseTo(-0.1, 6);
    expect(approvalAdjustedIncumbencyBudget(20)).toBeCloseTo(-0.1, 6);
    expect(approvalAdjustedIncumbencyBudget(0)).toBeCloseTo(-0.1, 6);
  });

  it("falls back to the flat 0.10 budget on missing / NaN approval", () => {
    expect(approvalAdjustedIncumbencyBudget(undefined)).toBeCloseTo(0.1, 6);
    expect(approvalAdjustedIncumbencyBudget(Number.NaN)).toBeCloseTo(0.1, 6);
  });
});

describe("incumbencyDriver directional (executive own-race)", () => {
  it("drags the unpopular incumbent and boosts the challenger", () => {
    const opts: DistributeVotesOptions = { incumbentPartyId: "dem", incumbentApproval: 33 };
    expect(incPct("dem", "rep", opts)).toBeCloseTo(-10, 4); // incumbent dragged (cap, pivot 46)
    expect(incPct("rep", "dem", opts)).toBeCloseTo(10, 4); // challenger boosted
  });

  it("shields the popular incumbent up to the +10pp cap", () => {
    const opts: DistributeVotesOptions = { incumbentPartyId: "dem", incumbentApproval: 70 };
    expect(incPct("dem", "rep", opts)).toBeCloseTo(10, 4);
  });

  it("is neutral between two non-incumbent parties", () => {
    const opts: DistributeVotesOptions = { incumbentPartyId: "dem", incumbentApproval: 20 };
    expect(incPct("grn", "lib", opts)).toBeCloseTo(0, 6);
  });
});

describe("incumbencyDriver no longer carries party-tenure fatigue", () => {
  // Term fatigue moved to the economic referendum channel, which scales the
  // penalty side of a national share shift. The incumbency driver is now the
  // pure approval shield/drag, whatever the incumbent party's tenure.
  it("leaves the approval shield intact regardless of consecutive terms", () => {
    const opts: DistributeVotesOptions = {
      incumbentPartyId: "dem",
      incumbentApproval: 70,
      incumbentConsecutiveTerms: 4,
    };
    expect(incPct("dem", "rep", opts)).toBeCloseTo(10, 4);
    expect(incPct("rep", "dem", opts)).toBeCloseTo(-10, 4);
  });

  it("still drags an unpopular incumbent on approval alone", () => {
    const opts: DistributeVotesOptions = {
      incumbentPartyId: "dem",
      incumbentApproval: 20,
      incumbentConsecutiveTerms: 1,
    };
    expect(incPct("dem", "rep", opts)).toBeCloseTo(-10, 4);
  });
});

describe("incumbencyDriver seat-share fallback (no incumbentPartyId)", () => {
  it("keeps the prior (shareJ - shareI) × 0.10 behavior", () => {
    const opts: DistributeVotesOptions = {
      incumbentSeatShareByParty: new Map([
        ["dem", 1],
        ["rep", 0],
      ]),
    };
    expect(incPct("dem", "rep", opts)).toBeCloseTo(10, 4);
    expect(incPct("rep", "dem", opts)).toBeCloseTo(-10, 4);
  });
});

describe("incumbencyDriver single-seat legislative (US Senate)", () => {
  it("flat +6 for a first-term incumbent, symmetric challenger drag", () => {
    const opts: DistributeVotesOptions = {
      legislativeIncumbentPartyId: "dem",
      legislativeIncumbentTenureTerms: 1,
    };
    expect(incPct("dem", "rep", opts)).toBeCloseTo(6, 4);
    expect(incPct("rep", "dem", opts)).toBeCloseTo(-6, 4);
  });

  it("decays 1pt per term: 3 terms → +4, 6 terms → +1", () => {
    const three: DistributeVotesOptions = {
      legislativeIncumbentPartyId: "dem",
      legislativeIncumbentTenureTerms: 3,
    };
    const six: DistributeVotesOptions = {
      legislativeIncumbentPartyId: "dem",
      legislativeIncumbentTenureTerms: 6,
    };
    expect(incPct("dem", "rep", three)).toBeCloseTo(4, 4);
    expect(incPct("dem", "rep", six)).toBeCloseTo(1, 4);
  });

  it("never drops below the +1 floor no matter the tenure", () => {
    const opts: DistributeVotesOptions = {
      legislativeIncumbentPartyId: "dem",
      legislativeIncumbentTenureTerms: 40,
    };
    expect(incPct("dem", "rep", opts)).toBeCloseTo(1, 4);
    expect(incPct("rep", "dem", opts)).toBeCloseTo(-1, 4);
  });

  it("defaults to +6 when tenure is unset", () => {
    const opts: DistributeVotesOptions = { legislativeIncumbentPartyId: "dem" };
    expect(incPct("dem", "rep", opts)).toBeCloseTo(6, 4);
  });

  it("is neutral between two non-incumbent parties", () => {
    const opts: DistributeVotesOptions = {
      legislativeIncumbentPartyId: "dem",
      legislativeIncumbentTenureTerms: 2,
    };
    expect(incPct("grn", "lib", opts)).toBeCloseTo(0, 6);
  });

  it("takes precedence over the seat-share fallback", () => {
    const opts: DistributeVotesOptions = {
      legislativeIncumbentPartyId: "dem",
      legislativeIncumbentTenureTerms: 1,
      incumbentSeatShareByParty: new Map([
        ["dem", 0.52],
        ["rep", 0.48],
      ]),
    };
    // Flat +6 wins, not the (0.52 − 0.48) × 0.10 = 0.4pt fallback.
    expect(incPct("dem", "rep", opts)).toBeCloseTo(6, 4);
  });
});
