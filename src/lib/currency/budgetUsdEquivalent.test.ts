import { describe, expect, it } from "vitest";
import { budgetUsdEquivalent } from "./budgetUsdEquivalent";

describe("budgetUsdEquivalent", () => {
  it("converts 1953 Soviet outlays at the authored 9 SUR/USD rate (ticket-1065)", () => {
    const local = 565_992_434_499;
    const usd = budgetUsdEquivalent(local, "RU", "1953-default");
    expect(usd).not.toBeNull();
    expect(usd! / 1e9).toBeCloseTo(local / 9 / 1e9, 5);
    // Must not read as several-times-US spending when compared to ~$100B.
    expect(usd!).toBeGreaterThan(50_000_000_000);
    expect(usd!).toBeLessThan(80_000_000_000);
  });

  it("returns null for the US (already USD-of-the-era)", () => {
    expect(budgetUsdEquivalent(100_000_000_000, "US", "1953-default")).toBeNull();
  });

  it("returns null for 1953 Italy (regional GDP authored in USD millions)", () => {
    expect(budgetUsdEquivalent(50_000_000_000, "IT", "1953-default")).toBeNull();
  });

  it("does not use the 1979 1.35 ruble rate on a 1953 world", () => {
    const local = 565_992_434_499;
    const era1953 = budgetUsdEquivalent(local, "RU", "1953-default")!;
    const unscoped = budgetUsdEquivalent(local, "RU");
    expect(unscoped).not.toBeNull();
    expect(Math.abs(unscoped! - era1953)).toBeGreaterThan(100_000_000_000);
  });
});
