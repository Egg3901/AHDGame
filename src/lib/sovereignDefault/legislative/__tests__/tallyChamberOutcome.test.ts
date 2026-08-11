import { describe, it, expect } from "vitest";
import { tallyChamberOutcome } from "../tallyChamberOutcome";

describe("tallyChamberOutcome — simple majority", () => {
  it("more for than against → passed", () => {
    expect(tallyChamberOutcome({ votesFor: 60, votesAgainst: 40 })).toBe("passed");
  });

  it("more against than for → rejected", () => {
    expect(tallyChamberOutcome({ votesFor: 40, votesAgainst: 60 })).toBe("rejected");
  });

  it("tied votes → rejected (deadlock auto-fails)", () => {
    expect(tallyChamberOutcome({ votesFor: 50, votesAgainst: 50 })).toBe("rejected");
  });

  it("zero votes (no legislators showed up) → rejected", () => {
    expect(tallyChamberOutcome({ votesFor: 0, votesAgainst: 0 })).toBe("rejected");
  });
});
