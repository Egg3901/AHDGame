import { describe, expect, it } from "vitest";
import { getOpeningPolicyRate } from "./openingPolicyRate";

describe("January 1991 opening policy benchmarks", () => {
  it.each([
    ["US", 7],
    ["UK", 13.88],
    ["JP", 6],
    ["DE", 6],
    ["IE", 11.25],
  ] as const)("%s uses the start-date benchmark", (country, expected) => {
    expect(getOpeningPolicyRate(country, 1991, 3)).toBe(expected);
  });
  it.each([1953, 1979, 1999, 2019, 2027, undefined])("leaves year %s unchanged", (year) => {
    expect(getOpeningPolicyRate("JP", year, 1)).toBe(1);
  });
  it("leaves an unauthored country at its existing value", () => {
    expect(getOpeningPolicyRate("FR", 1991, 9.5)).toBe(9.5);
  });
});
