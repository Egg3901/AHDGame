import { describe, it, expect } from "vitest";
import { countryScale } from "../force";

describe("countryScale", () => {
  it("returns the configured scale for a known country", () => {
    expect(countryScale("US")).toBe(2.6);
  });

  it("defaults to 1 for an unknown country", () => {
    expect(countryScale("ZZ")).toBe(1);
  });
});
