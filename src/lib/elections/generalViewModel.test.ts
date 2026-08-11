import { describe, expect, it } from "vitest";
import {
  buildBattlegroundHoverCards,
  buildGeneralElectionViewModel,
  buildMarginByState,
  buildRegBreakdownByState,
  classifyMarginTier,
  pickFiveClosestStates,
} from "./generalViewModel";

describe("classifyMarginTier", () => {
  it("classifies bands correctly at boundaries", () => {
    expect(classifyMarginTier(20)).toBe("safe");
    expect(classifyMarginTier(15)).toBe("safe");
    expect(classifyMarginTier(14.99)).toBe("likely");
    expect(classifyMarginTier(10)).toBe("likely");
    expect(classifyMarginTier(9.99)).toBe("lean");
    expect(classifyMarginTier(5)).toBe("lean");
    expect(classifyMarginTier(4.99)).toBe("tossup");
    expect(classifyMarginTier(0)).toBe("tossup");
  });
});

describe("buildMarginByState", () => {
  const colors = new Map([
    ["dem", "#0000ff"],
    ["gop", "#ff0000"],
  ]);

  it("computes leader + margin from vote totals", () => {
    const result = buildMarginByState(
      {
        CA: { dem: 600, gop: 400 },
        TX: { dem: 350, gop: 650 },
      },
      colors
    );
    expect(result.CA.leaderId).toBe("dem");
    expect(result.CA.margin).toBeCloseTo(20);
    expect(result.CA.tier).toBe("safe");
    expect(result.TX.leaderId).toBe("gop");
    expect(result.TX.margin).toBeCloseTo(30);
  });

  it("skips states with fewer than two non-zero candidates", () => {
    const result = buildMarginByState({ FL: { dem: 100 } }, colors);
    expect(result.FL).toBeUndefined();
  });

  it("skips states with zero total votes", () => {
    const result = buildMarginByState({ NY: { dem: 0, gop: 0 } }, colors);
    expect(result.NY).toBeUndefined();
  });

  it("falls back to neutral grey when leader color is missing", () => {
    const result = buildMarginByState({ AZ: { unknown: 60, gop: 40 } }, colors);
    expect(result.AZ.leaderColor).toBe("#9CA3AF");
  });
});

describe("pickFiveClosestStates", () => {
  it("returns up to 5 states sorted by smallest margin", () => {
    const margins = {
      CA: { leaderId: "dem", leaderColor: "#0000ff", margin: 30, tier: "safe" as const },
      TX: { leaderId: "gop", leaderColor: "#ff0000", margin: 25, tier: "safe" as const },
      PA: { leaderId: "dem", leaderColor: "#0000ff", margin: 2, tier: "tossup" as const },
      MI: { leaderId: "dem", leaderColor: "#0000ff", margin: 4, tier: "tossup" as const },
      WI: { leaderId: "gop", leaderColor: "#ff0000", margin: 3, tier: "tossup" as const },
      AZ: { leaderId: "dem", leaderColor: "#0000ff", margin: 6, tier: "lean" as const },
      GA: { leaderId: "gop", leaderColor: "#ff0000", margin: 1, tier: "tossup" as const },
    };
    const result = pickFiveClosestStates(margins);
    // Sorted by margin ascending: GA(1), PA(2), WI(3), MI(4), AZ(6)
    expect(result).toEqual(["GA", "PA", "WI", "MI", "AZ"]);
  });

  it("returns fewer than 5 when fewer states are present", () => {
    const margins = {
      CA: { leaderId: "dem", leaderColor: "#0000ff", margin: 5, tier: "lean" as const },
      TX: { leaderId: "gop", leaderColor: "#ff0000", margin: 10, tier: "likely" as const },
    };
    expect(pickFiveClosestStates(margins)).toEqual(["CA", "TX"]);
  });

  it("returns empty for empty input", () => {
    expect(pickFiveClosestStates({})).toEqual([]);
  });
});

describe("buildRegBreakdownByState", () => {
  const partyDisplay = {
    "1": { abbr: "D", color: "#0000ff" },
    "2": { abbr: "R", color: "#ff0000" },
  };

  it("emits bootstrapped breakdown when shares present, sorted by leanPct desc", () => {
    const result = buildRegBreakdownByState(
      {
        CA: {
          partyShares: [
            { partyId: "1", leanPct: 30 },
            { partyId: "2", leanPct: 50 },
          ],
          independent: 15,
          unregistered: 5,
        },
      },
      partyDisplay
    );
    expect(result.CA.bootstrapped).toBe(true);
    expect(result.CA.partyShares[0].partyId).toBe("2"); // largest lean first
    expect(result.CA.partyShares[1].partyId).toBe("1");
    expect(result.CA.independent).toBe(15);
    expect(result.CA.unregistered).toBe(5);
  });

  it("emits bootstrapped: false for states with empty partyShares (Phase 1.5 deferred)", () => {
    const result = buildRegBreakdownByState({ CA: { partyShares: [] } }, partyDisplay);
    expect(result.CA.bootstrapped).toBe(false);
    expect(result.CA.partyShares).toEqual([]);
  });

  it("clamps leanPct to [0, 100]", () => {
    const result = buildRegBreakdownByState(
      {
        AZ: {
          partyShares: [
            { partyId: "1", leanPct: -10 },
            { partyId: "2", leanPct: 150 },
          ],
        },
      },
      partyDisplay
    );
    expect(result.AZ.partyShares.find((p) => p.partyId === "1")?.leanPct).toBe(0);
    expect(result.AZ.partyShares.find((p) => p.partyId === "2")?.leanPct).toBe(100);
  });

  it("falls back to neutral chip for unknown parties", () => {
    const result = buildRegBreakdownByState(
      { TX: { partyShares: [{ partyId: "unknown", leanPct: 30 }] } },
      partyDisplay
    );
    expect(result.TX.partyShares[0].partyAbbr).toBe("?");
    expect(result.TX.partyShares[0].color).toBe("#9CA3AF");
  });
});

describe("buildGeneralElectionViewModel", () => {
  const candidates = [
    { id: "a", name: "Smith", color: "#0000ff", partyAbbr: "D" },
    { id: "b", name: "Jones", color: "#ff0000", partyAbbr: "R" },
  ];

  it("composes margin + 5-closest + reg", () => {
    const vm = buildGeneralElectionViewModel({
      candidates,
      stateVoteData: {
        CA: { a: 600, b: 400 },
        TX: { a: 350, b: 650 },
        PA: { a: 510, b: 490 },
      },
      regByState: {
        CA: { partyShares: [{ partyId: "1", leanPct: 50 }] },
        PA: { partyShares: [] },
      },
      partyDisplayById: { "1": { abbr: "D", color: "#0000ff" } },
    });
    expect(vm.candidates).toHaveLength(2);
    expect(Object.keys(vm.marginByState).length).toBe(3);
    expect(vm.fiveClosestStates[0]).toBe("PA"); // closest margin
    expect(vm.regBreakdownByState.CA.bootstrapped).toBe(true);
    expect(vm.regBreakdownByState.PA.bootstrapped).toBe(false);
  });

  it("falls back to empty objects when stateVoteData / regByState are missing", () => {
    const vm = buildGeneralElectionViewModel({ candidates });
    expect(vm.marginByState).toEqual({});
    expect(vm.regBreakdownByState).toEqual({});
    expect(vm.fiveClosestStates).toEqual([]);
  });
});

describe("buildBattlegroundHoverCards", () => {
  const baseInput = {
    candidates: [
      { id: "c-dem", name: "J. Smith", color: "#3B82F6", partyAbbr: "DEM" },
      { id: "c-rep", name: "M. Jones", color: "#EF4444", partyAbbr: "REP" },
      { id: "c-grn", name: "L. Lee", color: "#22C55E", partyAbbr: "GRN" },
    ],
  };

  it("returns top-2 candidates with shares + tier when 3rd is below 5%", () => {
    const cards = buildBattlegroundHoverCards({
      ...baseInput,
      stateNameById: { PA: "Pennsylvania" },
      stateVoteData: {
        PA: { "c-dem": 5210, "c-rep": 4740, "c-grn": 50 },
      },
    });
    expect(cards.PA).toBeDefined();
    expect(cards.PA.stateName).toBe("Pennsylvania");
    expect(cards.PA.candidates).toHaveLength(2);
    expect(cards.PA.candidates[0]).toEqual({
      name: "J. Smith",
      partyAbbr: "DEM",
      partyColor: "#3B82F6",
      votePct: expect.closeTo(52.1, 1),
    });
    expect(cards.PA.candidates[1].partyAbbr).toBe("REP");
    expect(cards.PA.marginPp).toBeCloseTo(4.7, 1);
    expect(cards.PA.tier).toBe("tossup");
  });

  it("returns top-3 candidates when 3rd is at or above 5%", () => {
    const cards = buildBattlegroundHoverCards({
      ...baseInput,
      stateNameById: { CA: "California" },
      stateVoteData: {
        CA: { "c-dem": 5000, "c-rep": 4500, "c-grn": 500 },
      },
    });
    expect(cards.CA.candidates).toHaveLength(3);
    expect(cards.CA.candidates.map((c) => c.partyAbbr)).toEqual(["DEM", "REP", "GRN"]);
  });

  it("falls back to neutral grey + ? abbr for unknown candidate id", () => {
    const cards = buildBattlegroundHoverCards({
      candidates: [{ id: "c-dem", name: "Smith", color: "#3B82F6", partyAbbr: "DEM" }],
      stateNameById: { TX: "Texas" },
      stateVoteData: {
        TX: { "c-dem": 1000, "c-unknown": 800 },
      },
    });
    expect(cards.TX.candidates).toHaveLength(2);
    const second = cards.TX.candidates[1];
    expect(second.partyColor).toBe("#9CA3AF");
    expect(second.partyAbbr).toBe("?");
    expect(second.name).toBe("?");
  });

  it("falls back to stateId when stateNameById has no entry", () => {
    const cards = buildBattlegroundHoverCards({
      ...baseInput,
      stateVoteData: {
        WY: { "c-dem": 100, "c-rep": 200 },
      },
    });
    expect(cards.WY.stateName).toBe("WY");
  });

  it("skips states with fewer than 2 non-zero vote candidates", () => {
    const cards = buildBattlegroundHoverCards({
      ...baseInput,
      stateNameById: { ND: "North Dakota" },
      stateVoteData: {
        ND: { "c-dem": 0, "c-rep": 100, "c-grn": 0 },
      },
    });
    expect(cards.ND).toBeUndefined();
  });

  it("returns an empty record when stateVoteData is missing or empty", () => {
    expect(buildBattlegroundHoverCards({ ...baseInput })).toEqual({});
    expect(buildBattlegroundHoverCards({ ...baseInput, stateVoteData: {} })).toEqual({});
  });
});
