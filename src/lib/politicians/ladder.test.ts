import { describe, expect, it } from "vitest";
import { ladderWidthPct } from "./ladder";

describe("ladderWidthPct", () => {
  it("scales to the current leader (leader = 100%)", () => {
    expect(ladderWidthPct(94.2, 94.2)).toBe(100);
    expect(ladderWidthPct(47.1, 94.2)).toBeCloseTo(50);
  });

  it("guards a zero or missing max (no divide-by-zero, empty bar)", () => {
    expect(ladderWidthPct(0, 0)).toBe(0);
    expect(ladderWidthPct(10, 0)).toBe(0);
  });

  it("clamps to 0..100 against bad inputs", () => {
    expect(ladderWidthPct(-5, 100)).toBe(0);
    expect(ladderWidthPct(150, 100)).toBe(100);
  });
});
