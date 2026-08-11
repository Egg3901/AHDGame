import { describe, expect, it } from "vitest";
import { namesForYear, gatedNameCount } from "./nameEra";
import { generateNPPNameAndGender } from "./nameGenerator";

describe("name era gating", () => {
  it("has a non-empty gate table", () => {
    // Non-vacuity: an empty table would make every assertion below pass while
    // the filter did nothing.
    expect(gatedNameCount()).toBeGreaterThan(20);
  });

  it("keeps the whole pool when there is no era clock", () => {
    const pool = ["James", "Aaliyah"];
    expect(namesForYear(pool, null)).toEqual(pool);
    expect(namesForYear(pool, undefined)).toEqual(pool);
  });

  // The bug: a 1953 senator called Aaliyah.
  it("excludes a modern coinage from an early era", () => {
    expect(namesForYear(["James", "Aaliyah"], 1953)).toEqual(["James"]);
    expect(namesForYear(["Mary", "Jessica"], 1953)).toEqual(["Mary"]);
  });

  // Traditional names carry no entry, and must not be swept up by the filter.
  it("keeps traditional names in every era", () => {
    for (const name of ["James", "John", "Mary", "Margaret", "Frank", "Ruth"]) {
      expect(namesForYear([name], 1953), name).toEqual([name]);
      expect(namesForYear([name], 2019), name).toEqual([name]);
    }
  });

  it("admits a gated name once its era arrives", () => {
    expect(namesForYear(["Jennifer"], 1953)).toEqual(["Jennifer"]); // never-empty guard
    expect(namesForYear(["Mary", "Jennifer"], 1953)).toEqual(["Mary"]);
    expect(namesForYear(["Mary", "Jennifer"], 2019)).toEqual(["Mary", "Jennifer"]);
  });

  // A generation failure is far worse than an anachronistic first name.
  it("never empties a pool whose every name is gated", () => {
    // Both must actually BE gated — an ungated name would survive the filter
    // and the never-empty guard would never be exercised.
    const pool = ["Aaliyah", "Jasmine"];
    expect(namesForYear(pool, 1953)).toEqual(pool);
  });

  it("a 1953 generator run draws no gated name", () => {
    const gated = new Set(["Aaliyah", "Jessica", "Jennifer", "Ashley", "Jasmine", "Zachary"]);
    for (let i = 0; i < 400; i++) {
      const first = generateNPPNameAndGender(1953).name.split(" ")[0];
      expect(gated.has(first), `drew ${first} in 1953`).toBe(false);
    }
  });

  it("a modern generator run still reaches the modern names", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 800; i++) {
      seen.add(generateNPPNameAndGender(2019).name.split(" ")[0]);
    }
    // At least one gated name should appear, or the modern pool has been
    // narrowed rather than the historical one.
    expect(
      ["Jennifer", "Jessica", "Ashley", "Ryan", "Joshua", "Michelle"].some((n) => seen.has(n))
    ).toBe(true);
  });

  it("surnames are untouched — they are inherited, not chosen", () => {
    const early = new Set<string>();
    const modern = new Set<string>();
    for (let i = 0; i < 400; i++) {
      early.add(generateNPPNameAndGender(1953).name.split(" ")[1]);
      modern.add(generateNPPNameAndGender(2019).name.split(" ")[1]);
    }
    // Both eras draw from the same surname list, so the variety is comparable.
    expect(early.size).toBeGreaterThan(50);
    expect(modern.size).toBeGreaterThan(50);
  });
});
