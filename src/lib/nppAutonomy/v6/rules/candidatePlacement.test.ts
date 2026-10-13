import { describe, expect, it } from "vitest";
import { compareStrongestFirst, nppCandidateStrength, placementOrder } from "./candidatePlacement";

const npp = (id: string, politicalInfluence?: number, favorability?: number) => ({
  _id: id,
  politicalInfluence,
  favorability,
});

describe("NPP engine 6.1 candidate placement", () => {
  it("scores strength from influence and favorability, treating gaps as zero", () => {
    expect(nppCandidateStrength(npp("a", 30, 40))).toBe(70);
    expect(nppCandidateStrength(npp("a", undefined, Number.NaN))).toBe(0);
  });

  it("sorts strongest first with a deterministic id tie-break", () => {
    const pool = [npp("c", 10, 10), npp("b", 50, 0), npp("a", 10, 10)];
    expect(pool.sort(compareStrongestFirst).map((n) => n._id)).toEqual(["b", "a", "c"]);
  });

  it("keeps the legacy coverage set and puts the most senior office first", () => {
    // Priority order as the legacy pass walks it: stateSenate(0), house(6), governor(17).
    const priority: Record<string, number> = { stateSenate: 0, house: 6, governor: 17 };
    const unfilled = ["stateSenate", "house", "governor"];
    expect(placementOrder(unfilled, 2, (p) => priority[p])).toEqual(["house", "stateSenate"]);
    expect(placementOrder(unfilled, 5, (p) => priority[p])).toEqual([
      "governor",
      "house",
      "stateSenate",
    ]);
    expect(placementOrder(unfilled, 0, (p) => priority[p])).toEqual([]);
  });
});
