import { describe, it, expect } from "vitest";
import { countryScale } from "./force";

describe("countryScale", () => {
  it("uses each nation's MILITARY_COUNTRY_SCALE, not a US-only value", () => {
    expect(countryScale("US")).toBe(2.6);
    expect(countryScale("RU")).toBe(2.4);
    expect(countryScale("DD")).toBe(1.2);
    expect(countryScale("UK")).toBe(1.7); // tuned up from 1.0 in this task
    // A simulated nation still resolves from the map. FR now carries an authored
    // scale of its own, which makes the point better than the old 1.0 did — that
    // value was indistinguishable from the no-entry fallback asserted below.
    expect(countryScale("FR")).toBe(1.5);
  });

  it("falls back to 1 for a code with no entry", () => {
    expect(countryScale("ZZ")).toBe(1);
  });
});
