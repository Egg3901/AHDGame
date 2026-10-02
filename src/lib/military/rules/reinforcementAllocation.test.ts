import { describe, expect, it } from "vitest";
import { allocateReinforcements } from "./reinforcementAllocation";

describe("allocateReinforcements", () => {
  it("shares scarcity proportionally instead of starving later units", () => {
    const plan = allocateReinforcements(
      [
        { id: "oldest", desired: 1_200 },
        { id: "newest", desired: 1_200 },
      ],
      300
    );
    expect(plan).toEqual(
      new Map([
        ["oldest", 150],
        ["newest", 150],
      ])
    );
  });

  it("never allocates more than a unit wants or the pool holds", () => {
    const plan = allocateReinforcements(
      [
        { id: "a", desired: 1 },
        { id: "b", desired: 4 },
      ],
      99
    );
    expect([...plan.values()].reduce((sum, value) => sum + value, 0)).toBe(5);
    expect(plan.get("a")).toBe(1);
    expect(plan.get("b")).toBe(4);
  });

  it("rejects malformed values that could poison or hang allocation", () => {
    expect(() =>
      allocateReinforcements([{ id: "a", desired: Number.POSITIVE_INFINITY }], 1)
    ).toThrow(RangeError);
    expect(() =>
      allocateReinforcements(
        [
          { id: "same", desired: 1 },
          { id: "same", desired: 1 },
        ],
        1
      )
    ).toThrow(/unique/);
  });
});
