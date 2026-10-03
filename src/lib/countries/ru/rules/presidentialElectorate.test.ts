import { describe, expect, it } from "vitest";
import { russianPresidentialRegisteredVoters as registered } from "./presidentialElectorate";
describe("Russian frozen presidential electorate", () => {
  it("counts voting-age registration separately in each region", () => {
    expect(
      registered(
        [
          { id: "a", population: 1000, votingEligiblePopulation: 700 },
          { id: "b", population: 500, votingEligiblePopulation: 350 },
        ],
        { a: 10 }
      )
    ).toBe(980);
  });
  it("preserves the existing population and missing-registration fallback", () => {
    expect(registered([{ id: "a", population: 1000 }], {})).toBe(1000);
  });
  it("never counts fractional people", () => {
    expect(
      registered([{ id: "a", population: 101, votingEligiblePopulation: 70.5 }], { a: 7 })
    ).toBe(65);
  });
  it("applies the established registration clamp", () => {
    expect(
      registered(
        [
          { id: "a", population: 100 },
          { id: "b", population: 100 },
        ],
        { a: 120, b: -1 }
      )
    ).toBe(100);
  });
  it("rejects missing, duplicated, empty and overflowing electorates", () => {
    expect(() => registered([], {})).toThrow();
    expect(() =>
      registered(
        [
          { id: "a", population: 100 },
          { id: "a", population: 100 },
        ],
        {}
      )
    ).toThrow();
    expect(() => registered([{ id: "a", population: 100 }], { a: 100 })).toThrow();
    expect(() =>
      registered(
        [
          { id: "a", population: Number.MAX_SAFE_INTEGER },
          { id: "b", population: 1 },
        ],
        {}
      )
    ).toThrow();
  });
  it("rejects nonfinite or negative voting-age inputs", () => {
    for (const votingEligiblePopulation of [-1, NaN, Infinity])
      expect(() =>
        registered([{ id: "a", population: 100, votingEligiblePopulation }], {})
      ).toThrow();
  });
});
