import { describe, expect, it } from "vitest";
import {
  computePersuasionDriverDisplay,
  computePairwiseDriverDisplay,
  pickDefaultDriverPair,
  persuadableSlicePct,
  computePersuadableSliceReadout,
} from "./computePersuasionDriverDisplay";

interface PublicCandidate {
  id: string;
  characterId: string;
  party: string;
  partyColor: string;
  partyEcon: number;
  partySocial: number;
  economicPosition: number;
  socialPosition: number;
  favorability: number;
  politicalInfluence: number;
  nationalInfluence: number;
  isNPP: boolean;
  sharePct: number;
  support?: number;
}

function candidate(overrides: Partial<PublicCandidate> & { party: string }): PublicCandidate {
  const base: PublicCandidate = {
    id: `c-${overrides.party}`,
    characterId: `ch-${overrides.party}`,
    party: overrides.party,
    partyColor: "#888",
    partyEcon: 0,
    partySocial: 0,
    economicPosition: 0,
    socialPosition: 0,
    favorability: 50,
    politicalInfluence: 60,
    nationalInfluence: 60,
    isNPP: false,
    sharePct: 50,
  };
  return { ...base, ...overrides };
}

describe("legislative (US Senate) incumbency row", () => {
  it("renders the flat +6 shield for a first-term incumbent (leader = incumbent)", () => {
    const candidates = [
      candidate({ party: "dem", sharePct: 52 }),
      candidate({ party: "rep", sharePct: 48 }),
    ];
    const rows = computePersuasionDriverDisplay(candidates, {
      legislativeIncumbentPartyId: "dem",
      legislativeIncumbentTenureTerms: 1,
      // No regByParty → effectivePeelableFraction uses the 0.20 no-Reg baseline.
    });
    const inc = rows.find((r) => r.label === "Incumbency");
    expect(inc).toBeDefined();
    // 6pts × 0.20 peelable baseline = 1.2 displayed pts.
    expect(inc!.contributionPct).toBeCloseTo(1.2, 4);
  });
});

describe("computePersuasionDriverDisplay", () => {
  it("returns empty list when fewer than 2 candidates", () => {
    const out = computePersuasionDriverDisplay([candidate({ party: "dem" })]);
    expect(out).toEqual([]);
  });

  it("returns empty list when top two candidates share a party", () => {
    // Primary-style same-party top-2 — the driver framework is cross-party only.
    const cands = [
      candidate({ party: "dem", id: "c1", sharePct: 30 }),
      candidate({ party: "dem", id: "c2", sharePct: 25 }),
    ];
    const out = computePersuasionDriverDisplay(cands);
    expect(out).toEqual([]);
  });

  it("returns labeled rows when leader and runner-up are different parties", () => {
    const cands = [
      candidate({ party: "dem", sharePct: 55, economicPosition: 0, socialPosition: 0 }),
      candidate({ party: "rep", sharePct: 45, economicPosition: 2, socialPosition: 2 }),
    ];
    const out = computePersuasionDriverDisplay(cands);
    // 4 engine components: Candidate Support, Policy alignment, Money,
    // Incumbency. (Presidential / Gubernatorial coattails are nominal-share
    // tilt rows appended only when their inputs are supplied.)
    expect(out.map((d) => d.label)).toEqual([
      "Candidate Support",
      "Policy alignment",
      "Money",
      "Incumbency",
    ]);
  });

  it("Policy alignment row is non-zero when leader is more centrist than runner-up", () => {
    const cands = [
      candidate({ party: "dem", sharePct: 55, economicPosition: 0, socialPosition: 0 }),
      candidate({ party: "rep", sharePct: 45, economicPosition: 3, socialPosition: 3 }),
    ];
    const out = computePersuasionDriverDisplay(cands);
    const policy = out.find((d) => d.label === "Policy alignment");
    // dem at (0,0) is closer to center than rep at (3,3); positive driver in favor of leader.
    expect(policy?.contributionPct).toBeGreaterThan(0);
  });

  it("Candidate Support / Money / Incumbency rows are 0 when no extra data passed", () => {
    // Public DTO doesn't expose Support / funds; rows render as deliberate
    // zeros so the card still labels the driver framework.
    const cands = [
      candidate({ party: "dem", sharePct: 55 }),
      candidate({ party: "rep", sharePct: 45 }),
    ];
    const out = computePersuasionDriverDisplay(cands);
    expect(out.find((d) => d.label === "Candidate Support")?.contributionPct).toBe(0);
    expect(out.find((d) => d.label === "Money")?.contributionPct).toBe(0);
    expect(out.find((d) => d.label === "Incumbency")?.contributionPct).toBe(0);
    // Presidential Popularity row is absent unless its input is supplied.
    expect(out.find((d) => d.label === "Presidential Popularity")).toBeUndefined();
  });

  it("Candidate Support row is non-zero when candidate.support deltas are present", () => {
    // Privileged viewer scenario: server enriches candidates with raw Support.
    const cands = [
      candidate({ party: "dem", sharePct: 55, support: 80 }),
      candidate({ party: "rep", sharePct: 45, support: 30 }),
    ];
    const out = computePersuasionDriverDisplay(cands);
    const support = out.find((d) => d.label === "Candidate Support");
    expect(support?.contributionPct).toBeGreaterThan(0); // delta (80-30)/100 × budget × scale
  });

  it("Money row populates when fundsByParty passed", () => {
    const cands = [
      candidate({ party: "dem", sharePct: 55 }),
      candidate({ party: "rep", sharePct: 45 }),
    ];
    const out = computePersuasionDriverDisplay(cands, {
      fundsByParty: { dem: 10_000_000, rep: 500_000 },
    });
    const money = out.find((d) => d.label === "Money");
    expect(money?.contributionPct).toBeGreaterThan(0); // dem outspends rep
  });

  it("Incumbency row populates when incumbentSeatShareByParty passed", () => {
    const cands = [
      candidate({ party: "dem", sharePct: 55 }),
      candidate({ party: "rep", sharePct: 45 }),
    ];
    const out = computePersuasionDriverDisplay(cands, {
      incumbentSeatShareByParty: { dem: 1.0, rep: 0.0 },
    });
    const incumbency = out.find((d) => d.label === "Incumbency");
    // T1: (1.0 - 0.0) × INCUMBENCY_BUDGET(0.10) × scale(100) = 10 pts raw,
    // × no-Reg effective peelable fraction (0.20) = 2 pts displayed.
    expect(incumbency?.contributionPct).toBeCloseTo(2);
  });

  it("All 4 plumbable drivers populate when all inputs are supplied", () => {
    const cands = [
      candidate({
        party: "dem",
        sharePct: 55,
        support: 80,
        economicPosition: 0,
        socialPosition: 0,
      }),
      candidate({
        party: "rep",
        sharePct: 45,
        support: 30,
        economicPosition: 2,
        socialPosition: 2,
      }),
    ];
    const out = computePersuasionDriverDisplay(cands, {
      fundsByParty: { dem: 10_000_000, rep: 500_000 },
      incumbentSeatShareByParty: { dem: 1.0, rep: 0.0 },
    });
    expect(out.find((d) => d.label === "Candidate Support")?.contributionPct).toBeGreaterThan(0);
    expect(out.find((d) => d.label === "Policy alignment")?.contributionPct).toBeGreaterThan(0);
    expect(out.find((d) => d.label === "Money")?.contributionPct).toBeGreaterThan(0);
    expect(out.find((d) => d.label === "Incumbency")?.contributionPct).toBeGreaterThan(0);
    // Presidential Popularity row is absent — its input is not supplied here.
    expect(out.find((d) => d.label === "Presidential Popularity")).toBeUndefined();
  });

  it("Policy alignment shifts when medianVoter is supplied (M5)", () => {
    // Both candidates equidistant from (0,0) in absolute terms, but the
    // state's actual median sits at (2, 2). Rep at (3, 3) is closer to
    // that median than Dem at (0, 0), so the policy-alignment driver
    // should flip negative (Rep is more centrist relative to the state).
    const cands = [
      candidate({ party: "dem", sharePct: 55, economicPosition: 0, socialPosition: 0 }),
      candidate({ party: "rep", sharePct: 45, economicPosition: 3, socialPosition: 3 }),
    ];
    const withoutMedian = computePersuasionDriverDisplay(cands);
    const withMedian = computePersuasionDriverDisplay(cands, {
      medianVoter: { ep: 2, sp: 2 },
    });
    const before = withoutMedian.find((d) => d.label === "Policy alignment")!.contributionPct;
    const after = withMedian.find((d) => d.label === "Policy alignment")!.contributionPct;
    // Without a median, leader Dem at (0,0) is more centrist → positive.
    expect(before).toBeGreaterThan(0);
    // With median at (2,2), Rep is closer → driver flips negative.
    expect(after).toBeLessThan(0);
  });

  it("uses popular-vote leader's party color for every row", () => {
    const cands = [
      candidate({ party: "dem", sharePct: 55, partyColor: "#1976d2" }),
      candidate({ party: "rep", sharePct: 45, partyColor: "#d32f2f" }),
    ];
    const out = computePersuasionDriverDisplay(cands);
    for (const d of out) {
      expect(d.color).toBe("#1976d2");
    }
  });
});

describe("pickDefaultDriverPair", () => {
  it("returns null when fewer than 2 candidates", () => {
    expect(pickDefaultDriverPair([candidate({ party: "dem" })])).toBeNull();
  });

  it("returns null when every candidate shares one party (no cross-party rival)", () => {
    const cands = [
      candidate({ party: "dem", id: "c1", sharePct: 30 }),
      candidate({ party: "dem", id: "c2", sharePct: 25 }),
    ];
    expect(pickDefaultDriverPair(cands)).toBeNull();
  });

  it("picks the leader as focus and the top cross-party candidate as opponent", () => {
    const cands = [
      candidate({ party: "dem", id: "d1", sharePct: 55 }),
      candidate({ party: "dem", id: "d2", sharePct: 30 }),
      candidate({ party: "rep", id: "r1", sharePct: 15 }),
    ];
    expect(pickDefaultDriverPair(cands)).toEqual({ focusId: "d1", opponentId: "r1" });
  });
});

describe("computePairwiseDriverDisplay", () => {
  it("returns [] when the focus id is not found", () => {
    const cands = [
      candidate({ party: "dem", id: "d1", sharePct: 55 }),
      candidate({ party: "rep", id: "r1", sharePct: 45 }),
    ];
    expect(computePairwiseDriverDisplay(cands, "missing", "r1")).toEqual([]);
  });

  it("returns [] when the opponent id is not found", () => {
    const cands = [
      candidate({ party: "dem", id: "d1", sharePct: 55 }),
      candidate({ party: "rep", id: "r1", sharePct: 45 }),
    ];
    expect(computePairwiseDriverDisplay(cands, "d1", "missing")).toEqual([]);
  });

  it("routes the chosen pair to the engine and tints rows with the focus party color", () => {
    const cands = [
      candidate({ party: "dem", id: "d1", sharePct: 30, partyColor: "#1976d2" }),
      candidate({ party: "rep", id: "r1", sharePct: 55, partyColor: "#d32f2f" }),
    ];
    // Focus is the trailing dem here (explicit pick, not the leader).
    const out = computePairwiseDriverDisplay(cands, "d1", "r1");
    expect(out.map((d) => d.label)).toEqual([
      "Candidate Support",
      "Policy alignment",
      "Money",
      "Incumbency",
    ]);
    for (const d of out) expect(d.color).toBe("#1976d2");
  });

  it("swapping focus/opponent flips the sign of a non-zero driver", () => {
    const cands = [
      candidate({ party: "dem", id: "d1", sharePct: 55, support: 80 }),
      candidate({ party: "rep", id: "r1", sharePct: 45, support: 30 }),
    ];
    const demFocus = computePairwiseDriverDisplay(cands, "d1", "r1").find(
      (d) => d.label === "Candidate Support"
    )!.contributionPct;
    const repFocus = computePairwiseDriverDisplay(cands, "r1", "d1").find(
      (d) => d.label === "Candidate Support"
    )!.contributionPct;
    expect(demFocus).toBeGreaterThan(0);
    expect(repFocus).toBeCloseTo(-demFocus);
  });

  it("appends a %-unit Presidential Popularity row from presidentialCoattailPctByParty", () => {
    const cands = [
      candidate({ party: "dem", id: "d1", sharePct: 55, partyColor: "#1976d2" }),
      candidate({ party: "rep", id: "r1", sharePct: 45 }),
    ];
    const out = computePairwiseDriverDisplay(cands, "d1", "r1", {
      presidentialCoattailPctByParty: { dem: 9 },
    });
    const pres = out.find((d) => d.label === "Presidential Popularity");
    expect(pres?.unit).toBe("%");
    expect(pres?.contributionPct).toBeCloseTo(9);
    // Swapping focus/opponent flips the sign (focus minus opponent tilt).
    const swapped = computePairwiseDriverDisplay(cands, "r1", "d1", {
      presidentialCoattailPctByParty: { dem: 9 },
    });
    expect(swapped.find((d) => d.label === "Presidential Popularity")!.contributionPct).toBeCloseTo(
      -9
    );
  });

  it("omits the Presidential Popularity row when no presidential input is supplied", () => {
    const cands = [
      candidate({ party: "dem", id: "d1", sharePct: 55 }),
      candidate({ party: "rep", id: "r1", sharePct: 45 }),
    ];
    const out = computePairwiseDriverDisplay(cands, "d1", "r1");
    expect(out.find((d) => d.label === "Presidential Popularity")).toBeUndefined();
  });

  it("appends a %-unit Gubernatorial Coattails row from gubernatorialCoattailPctByParty", () => {
    const cands = [
      candidate({ party: "rep", id: "r1", sharePct: 55, partyColor: "#d32f2f" }),
      candidate({ party: "dem", id: "d1", sharePct: 45 }),
    ];
    const out = computePairwiseDriverDisplay(cands, "r1", "d1", {
      gubernatorialCoattailPctByParty: { rep: 4.5 },
    });
    const gov = out.find((d) => d.label === "Gubernatorial Coattails");
    expect(gov?.unit).toBe("%");
    expect(gov?.contributionPct).toBeCloseTo(4.5);
    const swapped = computePairwiseDriverDisplay(cands, "d1", "r1", {
      gubernatorialCoattailPctByParty: { rep: 4.5 },
    });
    expect(swapped.find((d) => d.label === "Gubernatorial Coattails")!.contributionPct).toBeCloseTo(
      -4.5
    );
  });

  it("omits the Gubernatorial Coattails row when no gubernatorial input is supplied", () => {
    const cands = [
      candidate({ party: "dem", id: "d1", sharePct: 55 }),
      candidate({ party: "rep", id: "r1", sharePct: 45 }),
    ];
    const out = computePairwiseDriverDisplay(cands, "d1", "r1");
    expect(out.find((d) => d.label === "Gubernatorial Coattails")).toBeUndefined();
  });

  it("shows the midterm opposition tilt from the focused party's perspective", () => {
    const cands = [
      candidate({ party: "gov", id: "g1", sharePct: 55 }),
      candidate({ party: "opp", id: "o1", sharePct: 45, partyColor: "#1976d2" }),
    ];
    const opposition = computePairwiseDriverDisplay(cands, "o1", "g1", {
      midtermOppositionBoostPctByParty: { opp: 5 },
    }).find((driver) => driver.label === "Midterm Opposition");
    expect(opposition?.unit).toBe("%");
    expect(opposition?.contributionPct).toBeCloseTo(5);

    const government = computePairwiseDriverDisplay(cands, "g1", "o1", {
      midtermOppositionBoostPctByParty: { opp: 5 },
    }).find((driver) => driver.label === "Midterm Opposition");
    expect(government?.contributionPct).toBeCloseTo(-5);
  });
});

describe("Incumbency row honors executive approval", () => {
  const cands = [
    candidate({ party: "dem", id: "d1", sharePct: 52 }),
    candidate({ party: "rep", id: "r1", sharePct: 48 }),
  ];

  it("drags an unpopular incumbent governor (-10pp at approval 35, pivot 46)", () => {
    const rows = computePersuasionDriverDisplay(cands, {
      incumbentPartyId: "dem",
      incumbentApproval: 35,
    });
    const inc = rows.find((r) => r.label === "Incumbency");
    // Pivot recalibrated 50→43 (#2899), then 43→46 as approvals drifted up.
    // (46−35)×0.01 = −0.11 raw, clamped by INCUMBENCY_DRAG_MAX (0.10) to
    // −10pp, × no-Reg peelable fraction (0.20) = −2.0 pts displayed.
    expect(inc?.contributionPct).toBeCloseTo(-2.0, 4);
  });

  it("shields a popular incumbent governor (+10pp at approval 70)", () => {
    const rows = computePersuasionDriverDisplay(cands, {
      incumbentPartyId: "dem",
      incumbentApproval: 70,
    });
    const inc = rows.find((r) => r.label === "Incumbency");
    // +10pp raw × no-Reg peelable fraction (0.20) = +2 pts displayed.
    expect(inc?.contributionPct).toBeCloseTo(2, 4);
  });
});

describe("driver display peel scaling (UI honesty, #2891)", () => {
  const cands = [
    candidate({ party: "dem", id: "d1", sharePct: 52 }),
    candidate({ party: "rep", id: "r1", sharePct: 48 }),
  ];

  it("scales driver rows by the engine's effective peelable fraction, not raw pp", () => {
    const rows = computePairwiseDriverDisplay(cands, "d1", "r1", {
      incumbentSeatShareByParty: { dem: 1.0, rep: 0.0 },
    });
    const inc = rows.find((r) => r.label === "Incumbency");
    // Raw driver = +10pp; engine applies effectivePeelableFraction(undefined) = 0.20.
    expect(inc?.contributionPct).toBeCloseTo(10 * 0.2, 6);
    expect(inc?.unit).toBe("pts");
  });

  it("uses the peeled party's Reg entrenchment when regByParty is supplied", () => {
    // Positive driver peels the OPPONENT (rep). rep at Reg=100:
    // effectivePeelableFraction(100) = 0.10 × 0.50 = 0.05.
    const rows = computePairwiseDriverDisplay(cands, "d1", "r1", {
      incumbentSeatShareByParty: { dem: 1.0, rep: 0.0 },
      regByParty: { rep: 100, dem: 0 },
    });
    const inc = rows.find((r) => r.label === "Incumbency");
    expect(inc?.contributionPct).toBeCloseTo(10 * 0.05, 6);
  });

  it("negative drivers scale by the FOCUS party's peelable fraction", () => {
    // Focus dem has the drag (opponent holds the seat) — the peel comes out
    // of dem's pool, so dem's Reg=100 entrenchment applies (0.05), not rep's.
    const rows = computePairwiseDriverDisplay(cands, "d1", "r1", {
      incumbentSeatShareByParty: { dem: 0.0, rep: 1.0 },
      regByParty: { rep: 0, dem: 100 },
    });
    const inc = rows.find((r) => r.label === "Incumbency");
    expect(inc?.contributionPct).toBeCloseTo(-10 * 0.05, 6);
  });

  it("does NOT scale coattail rows: they stay true % share tilts", () => {
    const rows = computePairwiseDriverDisplay(cands, "d1", "r1", {
      gubernatorialCoattailPctByParty: { dem: 4.5 },
      regByParty: { rep: 100, dem: 100 },
    });
    const gov = rows.find((r) => r.label === "Gubernatorial Coattails");
    expect(gov?.contributionPct).toBeCloseTo(4.5);
    expect(gov?.unit).toBe("%");
  });
});

describe("persuadable-slice readout (ticket #1131)", () => {
  const cands = [
    candidate({ party: "dem", id: "d1", sharePct: 49 }),
    candidate({ party: "rep", id: "r1", sharePct: 51 }),
  ];

  it("reports the same fraction the engine peels", () => {
    // effectivePeelableFraction(100) = 0.10 × 0.50 = 0.05 → 5%.
    expect(persuadableSlicePct(100)).toBeCloseTo(5, 6);
    // No Reg data → the engine's 0.20 baseline.
    expect(persuadableSlicePct(undefined)).toBeCloseTo(20, 6);
  });

  it("reports both sides of the pair and the net driver total", () => {
    const inputs = {
      incumbentSeatShareByParty: { dem: 1.0, rep: 0.0 },
      regByParty: { dem: 59.7, rep: 40.3 },
    };
    const rows = computePairwiseDriverDisplay(cands, "d1", "r1", inputs);
    const readout = computePersuadableSliceReadout(rows, "dem", "rep", inputs);
    expect(readout.focusSlicePct).toBeCloseTo(persuadableSlicePct(59.7), 6);
    expect(readout.opponentSlicePct).toBeCloseTo(persuadableSlicePct(40.3), 6);
    // Net = sum of the already peel-scaled "pts" rows.
    const expected = rows
      .filter((r) => r.unit !== "%")
      .reduce((sum, r) => sum + r.contributionPct, 0);
    expect(readout.netDriverPts).toBeCloseTo(expected, 6);
  });

  it("excludes coattail % rows from the net driver total", () => {
    const inputs = { gubernatorialCoattailPctByParty: { dem: 4.5 } };
    const rows = computePairwiseDriverDisplay(cands, "d1", "r1", inputs);
    const readout = computePersuadableSliceReadout(rows, "dem", "rep", inputs);
    expect(readout.netDriverPts).toBeCloseTo(0, 6);
  });
});
