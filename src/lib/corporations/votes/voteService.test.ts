import { describe, it, expect } from "vitest";
import { computeVoteOutcome, checkAutoResolve } from "./voteService";

describe("computeVoteOutcome", () => {
  it("passes when yesShares meets threshold of all shares", () => {
    expect(
      computeVoteOutcome({ yesShares: 50, totalEligibleShares: 100, passThreshold: 0.5 })
    ).toBe("passed");
  });
  it("fails when yesShares below threshold", () => {
    expect(
      computeVoteOutcome({ yesShares: 49, totalEligibleShares: 100, passThreshold: 0.5 })
    ).toBe("failed");
  });
  it("uses ceil so threshold rounds up", () => {
    // 0.62 × 100 = 62 required; 61 fails, 62 passes
    expect(
      computeVoteOutcome({ yesShares: 61, totalEligibleShares: 100, passThreshold: 0.62 })
    ).toBe("failed");
    expect(
      computeVoteOutcome({ yesShares: 62, totalEligibleShares: 100, passThreshold: 0.62 })
    ).toBe("passed");
  });
});

describe("checkAutoResolve", () => {
  it("returns passed when yes is already certain", () => {
    // 50% threshold, 100 shares; 60 yes, 10 no → 30 remain; even if all 30 vote no: 60≥50 → passes
    expect(
      checkAutoResolve({
        yesShares: 60,
        noShares: 10,
        totalEligibleShares: 100,
        passThreshold: 0.5,
      })
    ).toBe("passed");
  });
  it("returns failed when yes is mathematically impossible", () => {
    // 0.62 threshold, 100 shares; 10 yes, 40 no → max possible yes = 10+50 = 60 < 62 → impossible
    expect(
      checkAutoResolve({
        yesShares: 10,
        noShares: 40,
        totalEligibleShares: 100,
        passThreshold: 0.62,
      })
    ).toBe("failed");
  });
  it("returns open when still uncertain", () => {
    expect(
      checkAutoResolve({
        yesShares: 20,
        noShares: 10,
        totalEligibleShares: 100,
        passThreshold: 0.5,
      })
    ).toBe("open");
  });
});
