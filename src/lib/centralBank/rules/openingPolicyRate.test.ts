import { describe, expect, it } from "vitest";
import { getOpeningPolicyRate, HISTORICAL_POLICY_RATES_1991 } from "./openingPolicyRate";

describe("Balanced 1991 opening policy rates", () => {
  it.each([
    ["US", 4],
    ["UK", 4.5],
    ["JP", 3],
    ["DE", 4],
    ["IE", 4.5],
  ] as const)("%s starts with affordable new borrowing", (country, expected) => {
    expect(getOpeningPolicyRate(country, 1991, 3)).toBe(expected);
  });
  it.each([1953, 1979, 1999, 2019, 2027, undefined])("leaves year %s unchanged", (year) => {
    expect(getOpeningPolicyRate("JP", year, 1)).toBe(1);
  });
  it("bounds every other opening rate and retains low defaults", () => {
    expect(getOpeningPolicyRate("FR", 1991, 9.5)).toBe(5);
    expect(getOpeningPolicyRate("CN", 1991, 2.75)).toBe(2.75);
  });
  it("preserves the historical benchmarks as provenance", () => {
    expect(HISTORICAL_POLICY_RATES_1991).toMatchObject({ US: 7, UK: 13.88, JP: 6 });
  });
});
