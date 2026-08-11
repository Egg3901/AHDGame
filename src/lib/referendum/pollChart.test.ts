import { describe, it, expect } from "vitest";
import { buildPollPath } from "./pollChart";

describe("buildPollPath", () => {
  it("returns an empty path for fewer than two points", () => {
    expect(buildPollPath([], 100, 40)).toBe("");
    expect(buildPollPath([{ turn: 1, yesShare: 50 }], 100, 40)).toBe("");
  });

  it("maps 0%/100% to the bottom/top of the box and spreads x evenly", () => {
    // Two points: x at 0 and width; 0% → y=height, 100% → y=0.
    const d = buildPollPath(
      [
        { turn: 1, yesShare: 0 },
        { turn: 2, yesShare: 100 },
      ],
      100,
      40
    );
    expect(d).toBe("M 0 40 L 100 0");
  });

  it("places the midpoint reading at half height", () => {
    const d = buildPollPath(
      [
        { turn: 1, yesShare: 50 },
        { turn: 2, yesShare: 50 },
        { turn: 3, yesShare: 50 },
      ],
      100,
      40
    );
    expect(d).toBe("M 0 20 L 50 20 L 100 20");
  });
});
