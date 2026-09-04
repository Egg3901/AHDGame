import { describe, expect, it } from "vitest";
import { INTEL_FOG_MAX_DEVIATION, INTEL_FOG_WINDOW_TURNS } from "./config";
import { fogFactor, fogInteger, fogWindow } from "./fog";

describe("fogFactor", () => {
  it("is stable for the same subject, window and figure", () => {
    // The property that makes it fog at all: a player refreshing a read endpoint
    // must see the SAME number, or the noise averages out and the fog is gone.
    expect(fogFactor("RU", 10, "warheads")).toBe(fogFactor("RU", 10, "warheads"));
  });

  it("is stable across every turn inside one window", () => {
    const first = fogFactor("RU", 0, "warheads");
    for (let t = 0; t < INTEL_FOG_WINDOW_TURNS; t++) {
      expect(fogFactor("RU", t, "warheads")).toBe(first);
    }
  });

  it("moves when the window rolls", () => {
    expect(fogFactor("RU", 0, "warheads")).not.toBe(
      fogFactor("RU", INTEL_FOG_WINDOW_TURNS, "warheads")
    );
  });

  it("gives independent figures independent factors", () => {
    // Sharing one factor publishes the exact RATIO of the two figures, because
    // the factor cancels when you divide them.
    expect(fogFactor("RU", 10, "warheads")).not.toBe(fogFactor("RU", 10, "nodes"));
  });

  it("distinguishes subjects", () => {
    expect(fogFactor("RU", 10, "warheads")).not.toBe(fogFactor("US", 10, "warheads"));
  });

  it("stays inside the published envelope", () => {
    for (let t = 0; t < 200; t++) {
      const f = fogFactor(`C${t}`, t, "warheads");
      expect(f).toBeGreaterThanOrEqual(1 - INTEL_FOG_MAX_DEVIATION);
      expect(f).toBeLessThanOrEqual(1 + INTEL_FOG_MAX_DEVIATION);
    }
  });
});

describe("fogInteger", () => {
  it("returns a whole number", () => {
    expect(Number.isInteger(fogInteger(137, "RU", 10, "warheads"))).toBe(true);
  });

  it("never reports a negative count", () => {
    expect(fogInteger(-50, "RU", 10, "warheads")).toBeGreaterThanOrEqual(0);
  });

  it("keeps a real figure within the envelope", () => {
    const fogged = fogInteger(1000, "RU", 10, "warheads");
    expect(fogged).toBeGreaterThanOrEqual(1000 * (1 - INTEL_FOG_MAX_DEVIATION) - 1);
    expect(fogged).toBeLessThanOrEqual(1000 * (1 + INTEL_FOG_MAX_DEVIATION) + 1);
  });

  it("reports zero as zero rather than inventing a stockpile", () => {
    expect(fogInteger(0, "RU", 10, "warheads")).toBe(0);
  });

  it("survives a non-finite input", () => {
    expect(fogInteger(Number.NaN, "RU", 10, "warheads")).toBe(0);
  });
});

describe("fogWindow", () => {
  it("buckets turns into stable windows", () => {
    expect(fogWindow(0)).toBe(0);
    expect(fogWindow(INTEL_FOG_WINDOW_TURNS)).toBe(1);
  });
});
