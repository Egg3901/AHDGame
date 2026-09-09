import { describe, expect, it } from "vitest";
import { buildTurnBriefing } from "./turnBriefing";

describe("buildTurnBriefing", () => {
  it("uses recorded deltas, orders by consequence, and caps the result", () => {
    const result = buildTurnBriefing(
      {
        sequentialId: 7,
        history: [
          { sharePrice: 10, marketingStrength: 4, liquidCapital: 100 },
          { sharePrice: 12, marketingStrength: 5, liquidCapital: 90 },
        ],
      },
      {
        electionId: "123456789012345678901234",
        history: [
          { pct: 40, seats: 2 },
          { pct: 43, seats: 3 },
        ],
      }
    );
    expect(result).toHaveLength(5);
    expect(result[0]).toMatchObject({ label: "Liquid capital", delta: -10 });
    expect(result.every((item) => item.href.startsWith("/"))).toBe(true);
  });

  it("omits unchanged and missing categories", () => {
    expect(buildTurnBriefing(null, null)).toEqual([]);
    expect(
      buildTurnBriefing(
        { sequentialId: 1, history: [{ sharePrice: 1, marketingStrength: 1, liquidCapital: 1 }] },
        null
      )
    ).toEqual([]);
  });
});
