import { describe, it, expect } from "vitest";
import { filterCountryResults } from "./countryResults";

const ENABLED = ["US", "UK", "RU", "DD"] as const;

describe("filterCountryResults", () => {
  it("returns every enabled country when the query is empty", () => {
    const r = filterCountryResults([...ENABLED], "", "1953-default");
    expect(r.map((x) => x.id)).toEqual(["US", "UK", "RU", "DD"]);
  });

  it("uses era display names", () => {
    const r = filterCountryResults([...ENABLED], "", "1953-default");
    expect(r.find((x) => x.id === "RU")?.name).toBe("Soviet Union");
    expect(r.find((x) => x.id === "DD")?.name).toBe("East Germany");
  });

  it("falls back to the era-neutral name without a preset", () => {
    const r = filterCountryResults([...ENABLED], "", undefined);
    expect(r.find((x) => x.id === "RU")?.name).toBe("Russia");
  });

  it("matches on name prefix, case-insensitively", () => {
    const r = filterCountryResults([...ENABLED], "sov", "1953-default");
    expect(r.map((x) => x.id)).toEqual(["RU"]);
  });

  it("matches on country code", () => {
    const r = filterCountryResults([...ENABLED], "dd", "1953-default");
    expect(r.map((x) => x.id)).toEqual(["DD"]);
  });

  it("caps results at Discord's 25-choice limit", () => {
    const many = Array.from({ length: 40 }, () => "US") as string[];
    expect(filterCountryResults(many, "", undefined).length).toBe(25);
  });

  it("honours a caller-supplied limit below the ceiling", () => {
    expect(filterCountryResults([...ENABLED], "", "1953-default", 2).map((x) => x.id)).toEqual([
      "US",
      "UK",
    ]);
  });

  it("never exceeds the Discord ceiling even when asked for more", () => {
    const many = Array.from({ length: 40 }, () => "US") as string[];
    expect(filterCountryResults(many, "", undefined, 100).length).toBe(25);
  });
});
