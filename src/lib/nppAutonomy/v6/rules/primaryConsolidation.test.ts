import { describe, expect, it } from "vitest";
import {
  CONSOLIDATION_WINDOW_TURNS,
  inConsolidationWindow,
  trailingCandidatesToWithdraw,
  type ConsolidationEntrant,
} from "./primaryConsolidation";

const npp = (id: string, strength: number, overrides: Partial<ConsolidationEntrant> = {}) => ({
  candidateId: `c-${id}`,
  party: "p",
  npp: { _id: id, politicalInfluence: strength, favorability: 0 },
  isIncumbent: false,
  ...overrides,
});

describe("NPP engine 6.4 primary consolidation", () => {
  it("applies only in the closing window", () => {
    expect(inConsolidationWindow(100, 100 - CONSOLIDATION_WINDOW_TURNS)).toBe(true);
    expect(inConsolidationWindow(100, 100 - CONSOLIDATION_WINDOW_TURNS - 1)).toBe(false);
    expect(inConsolidationWindow(100, 101)).toBe(false);
    expect(inConsolidationWindow(undefined, 50)).toBe(false);
  });

  it("withdraws NPPs under 60% of the party leader, keeping close rivals", () => {
    expect(
      trailingCandidatesToWithdraw([npp("a", 100), npp("b", 59), npp("c", 60), npp("d", 10)])
    ).toEqual(["c-b", "c-d"]);
  });

  it("never withdraws an incumbent", () => {
    expect(
      trailingCandidatesToWithdraw([npp("a", 100), npp("b", 10, { isIncumbent: true })])
    ).toEqual([]);
  });

  it("never touches a primary with a player in it", () => {
    expect(
      trailingCandidatesToWithdraw([
        npp("a", 100),
        npp("b", 10),
        { candidateId: "c-player", party: "p", isIncumbent: false },
      ])
    ).toEqual([]);
  });

  it("judges each party's field on its own", () => {
    expect(
      trailingCandidatesToWithdraw([npp("a", 100), npp("b", 90, { party: "q" }), npp("c", 10)])
    ).toEqual(["c-c"]);
  });
});
