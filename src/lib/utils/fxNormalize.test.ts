import { describe, expect, it } from "vitest";

import { toUsd } from "./fxNormalize";

describe("toUsd", () => {
  it("divides by the country's base rate", () => {
    // Rates are local currency per 1 USD, so a local value divides by the rate.
    expect(toUsd(106, "JP")).toBeCloseTo(1);
    expect(toUsd(75, "UK")).toBeCloseTo(100);
    expect(toUsd(92, "DE")).toBeCloseTo(100);
  });

  it("returns the value unchanged for an unknown country", () => {
    expect(toUsd(1234, "ZZ")).toBe(1234);
    expect(toUsd(1234, "")).toBe(1234);
  });

  it("short-circuits a rate of exactly 1", () => {
    // US and NG are both seeded at parity; the divide is skipped rather than
    // dividing by one.
    expect(toUsd(1234, "US")).toBe(1234);
    expect(toUsd(1234, "NG")).toBe(1234);
  });

  it("passes zero and negative values through the same conversion", () => {
    expect(toUsd(0, "JP")).toBe(0);
    expect(toUsd(-212, "JP")).toBeCloseTo(-2);
  });
});
