import { describe, it, expect } from "vitest";
import { classifyAuctionOutcome } from "../auctionOutcome";

describe("classifyAuctionOutcome", () => {
  it("classifies demand >= 1.0 as fullySubscribed and resets counter", () => {
    expect(classifyAuctionOutcome(1.0)).toEqual({ outcome: "fullySubscribed", counterDelta: 0 });
    expect(classifyAuctionOutcome(1.5)).toEqual({ outcome: "fullySubscribed", counterDelta: 0 });
  });

  it("classifies 0.7 <= demand < 1.0 as undersubscribed and resets counter", () => {
    expect(classifyAuctionOutcome(0.7)).toEqual({ outcome: "undersubscribed", counterDelta: 0 });
    expect(classifyAuctionOutcome(0.85)).toEqual({ outcome: "undersubscribed", counterDelta: 0 });
    expect(classifyAuctionOutcome(0.999)).toEqual({ outcome: "undersubscribed", counterDelta: 0 });
  });

  it("classifies demand < 0.7 as failed and increments counter", () => {
    expect(classifyAuctionOutcome(0.69)).toEqual({ outcome: "failed", counterDelta: 1 });
    expect(classifyAuctionOutcome(0.5)).toEqual({ outcome: "failed", counterDelta: 1 });
    expect(classifyAuctionOutcome(0)).toEqual({ outcome: "failed", counterDelta: 1 });
  });

  it("treats negative demand as failed (defensive)", () => {
    expect(classifyAuctionOutcome(-0.1)).toEqual({ outcome: "failed", counterDelta: 1 });
  });

  it("treats NaN as failed (defensive — broken input shouldn't reset counter)", () => {
    expect(classifyAuctionOutcome(Number.NaN)).toEqual({ outcome: "failed", counterDelta: 1 });
  });

  it("treats +Infinity as fullySubscribed", () => {
    expect(classifyAuctionOutcome(Number.POSITIVE_INFINITY)).toEqual({
      outcome: "fullySubscribed",
      counterDelta: 0,
    });
  });

  it("treats -Infinity as failed", () => {
    expect(classifyAuctionOutcome(Number.NEGATIVE_INFINITY)).toEqual({
      outcome: "failed",
      counterDelta: 1,
    });
  });

  it("threshold boundary at exactly DEMAND_FULL_THRESHOLD (1.0) is fullySubscribed", () => {
    expect(classifyAuctionOutcome(1.0).outcome).toBe("fullySubscribed");
  });

  it("threshold boundary at exactly DEMAND_UNDERSUBSCRIBED_THRESHOLD (0.7) is undersubscribed", () => {
    expect(classifyAuctionOutcome(0.7).outcome).toBe("undersubscribed");
  });
});
