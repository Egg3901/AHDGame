import { describe, expect, it } from "vitest";
import { isCurtained, isPlannedEconomy } from "./commandEconomy";

describe("iron curtain membership (isCurtained)", () => {
  it("keeps the bloc behind the curtain in 1953", () => {
    for (const country of ["RU", "UKR", "DD", "PL", "HU", "CS", "RO", "BG"]) {
      expect(isCurtained(country, 1953, true)).toBe(true);
    }
  });

  it("exempts Yugoslavia from the curtain while it remains a planned economy", () => {
    // Tito split: YU trades with the open world from before the era worlds
    // begin, but its DOMESTIC machinery stays planned (administered prices,
    // SOEs, overhang all key off isPlannedEconomy).
    expect(isCurtained("YU", 1953, true)).toBe(false);
    expect(isPlannedEconomy("YU", 1953, true)).toBe(true);
  });

  it("lifts the curtain on marketization dates, same as isPlannedEconomy", () => {
    expect(isCurtained("RU", 1992, true)).toBe(false);
    expect(isCurtained("CN", 1953, true)).toBe(true);
  });

  it("curtains nobody when the command-economy flag is off", () => {
    expect(isCurtained("RU", 1953, false)).toBe(false);
    expect(isCurtained("YU", 1953, false)).toBe(false);
  });

  it("never curtains market economies", () => {
    expect(isCurtained("US", 1953, true)).toBe(false);
    expect(isCurtained("UK", 1953, true)).toBe(false);
  });
});
