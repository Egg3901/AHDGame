import { describe, it, expect } from "vitest";
import {
  clampRetentionPercent,
  remitFraction,
  computeDrawAllowance,
  cappedRemittanceLocal,
} from "./ceoFinance";

describe("ceoFinance", () => {
  it("clamps retention to [0, 75]", () => {
    expect(clampRetentionPercent(40)).toBe(40);
    expect(clampRetentionPercent(-5)).toBe(0);
    expect(clampRetentionPercent(90)).toBe(75); // ≥25% always remits
    expect(clampRetentionPercent(undefined)).toBe(0);
  });

  it("remitFraction is 1 - retention (>= 0.25)", () => {
    expect(remitFraction(0)).toBeCloseTo(1);
    expect(remitFraction(75)).toBeCloseTo(0.25);
    expect(remitFraction(40)).toBeCloseTo(0.6);
  });

  it("computeDrawAllowance respects the per-turn cap and existing tally", () => {
    expect(computeDrawAllowance({ cap: 1000, drawnThisTurn: 300, sameTurn: true })).toBe(700);
    expect(computeDrawAllowance({ cap: 1000, drawnThisTurn: 300, sameTurn: false })).toBe(1000);
    expect(computeDrawAllowance({ cap: 0, drawnThisTurn: 0, sameTurn: true })).toBe(0);
    expect(computeDrawAllowance({ cap: 1000, drawnThisTurn: 1500, sameTurn: true })).toBe(0);
  });

  describe("cappedRemittanceLocal", () => {
    it("remits the (1 - retention) share when the SOE has ample cash", () => {
      expect(cappedRemittanceLocal(1000, 40, 1_000_000)).toBe(600); // 1000 × 0.6
      expect(cappedRemittanceLocal(1000, 75, 1_000_000)).toBe(250); // 25% floor
    });

    it("caps at on-hand liquidCapital — never overdraws", () => {
      expect(cappedRemittanceLocal(1000, 40, 100)).toBe(100); // uncapped 600 → capped to 100
    });

    it("remits nothing with no cash or a non-positive estimate", () => {
      expect(cappedRemittanceLocal(1000, 40, 0)).toBe(0); // loss-backed to zero
      expect(cappedRemittanceLocal(1000, 40, -500)).toBe(0); // negative balance
      expect(cappedRemittanceLocal(0, 40, 1_000_000)).toBe(0); // no profit
      expect(cappedRemittanceLocal(-200, 40, 1_000_000)).toBe(0); // operating loss
    });
  });
});
