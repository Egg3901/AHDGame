import { describe, it, expect } from "vitest";
import { fairnessApprovalPenalty } from "./fairnessApproval";

describe("fairnessApprovalPenalty", () => {
  it("is 0 within the ceiling", () => {
    expect(fairnessApprovalPenalty(0.05, 0.12)).toBe(0);
    expect(fairnessApprovalPenalty(0.12, 0.12)).toBe(0);
  });
  it("is a mild penalty just over the ceiling", () => {
    expect(fairnessApprovalPenalty(0.13, 0.12)).toBe(-2);
  });
  it("scales with the overage, capped at -5", () => {
    expect(fairnessApprovalPenalty(0.32, 0.12)).toBe(-5); // 0.20 over
    expect(fairnessApprovalPenalty(0.99, 0.12)).toBe(-5);
  });
});
