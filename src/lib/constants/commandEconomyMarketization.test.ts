import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  marketizationLevel,
  scheduledMarketizationLevel,
  setStoredMarketizationLevel,
  getStoredMarketizationLevel,
  hydrateStoredMarketizationLevels,
  clearStoredMarketizationLevels,
  marketizationDrift,
  driftMarketizationLevel,
  isCommandEconomy,
  isDualTrackEconomy,
  isPlannedEconomy,
  plannedShare,
  commandEconomySoeSectors,
  COMMAND_CEILING,
  DUAL_TRACK_CEILING,
} from "./commandEconomy";
import { SOE_PERF_BASELINE } from "@/lib/economy/soe";

beforeEach(() => clearStoredMarketizationLevels());
afterEach(() => clearStoredMarketizationLevels());

describe("stateful marketizationLevel", () => {
  it("falls back to the era schedule when no stored level exists (the seed)", () => {
    expect(getStoredMarketizationLevel("RU")).toBeUndefined();
    expect(marketizationLevel("RU", 1979)).toBe(scheduledMarketizationLevel("RU", 1979));
    expect(marketizationLevel("RU", 1979)).toBe(10);
  });

  it("returns the stored live level once persisted, overriding the schedule", () => {
    setStoredMarketizationLevel("RU", 42);
    expect(getStoredMarketizationLevel("RU")).toBe(42);
    // Schedule would say 10 in 1979; the stored value wins.
    expect(marketizationLevel("RU", 1979)).toBe(42);
  });

  it("clamps stored levels to 0..100", () => {
    setStoredMarketizationLevel("RU", 999);
    expect(marketizationLevel("RU", 1979)).toBe(100);
    setStoredMarketizationLevel("RU", -5);
    expect(marketizationLevel("RU", 1979)).toBe(0);
  });

  it("hydrate replaces the whole registry from persisted state", () => {
    setStoredMarketizationLevel("CN", 55);
    hydrateStoredMarketizationLevels([["RU", 20]]);
    expect(getStoredMarketizationLevel("RU")).toBe(20);
    expect(getStoredMarketizationLevel("CN")).toBeUndefined(); // cleared
  });
});

describe("marketizationDrift direction", () => {
  const orthodox = -0.2; // default NPP policy stance (mild orthodox)

  it("moves toward MARKET (+) under high shortage + weak SOEs", () => {
    const drift = marketizationDrift(/*pressure*/ 0.8, /*soePerf*/ 0.4, orthodox);
    expect(drift).toBeGreaterThan(0);
  });

  it("holds/entrenches (≤0) under low shortage + strong SOEs + orthodox policy", () => {
    const drift = marketizationDrift(/*pressure*/ 0.05, /*soePerf*/ 1.05, orthodox);
    expect(drift).toBeLessThanOrEqual(0);
  });

  it("a healthy on-plan world with a neutral/orthodox stance does not run away", () => {
    // 150 turns of a well-run world should NOT drift out of the command band.
    let level = 10;
    for (let t = 0; t < 150; t++) {
      const d = marketizationDrift(0.03, SOE_PERF_BASELINE, orthodox);
      level = driftMarketizationLevel(level, d);
    }
    expect(level).toBeLessThan(COMMAND_CEILING); // still command
  });

  it("a starved world reforms out of the command band over ~a few years", () => {
    let level = 10;
    for (let t = 0; t < 150; t++) {
      const d = marketizationDrift(0.7, 0.4, orthodox);
      level = driftMarketizationLevel(level, d);
    }
    expect(level).toBeGreaterThan(COMMAND_CEILING); // reformed past command
  });

  it("driftMarketizationLevel clamps to [0,100]", () => {
    expect(driftMarketizationLevel(99, 50)).toBe(100);
    expect(driftMarketizationLevel(1, -50)).toBe(0);
  });
});

describe("band predicates react to the STORED level", () => {
  it("a drifted-up RU flips out of the command band while the flag is on", () => {
    // Seeded schedule: RU 1979 = 10 (command).
    expect(isCommandEconomy("RU", 1979, true)).toBe(true);
    // Reform it past the dual-track ceiling.
    setStoredMarketizationLevel("RU", 80);
    expect(isCommandEconomy("RU", 1979, true)).toBe(false);
    expect(isDualTrackEconomy("RU", 1979, true)).toBe(false);
    expect(isPlannedEconomy("RU", 1979, true)).toBe(false);
    expect(plannedShare("RU", 1979, true)).toBe(0);
  });

  it("a mid-band stored level reads as dual-track", () => {
    setStoredMarketizationLevel("RU", (COMMAND_CEILING + DUAL_TRACK_CEILING) / 2);
    expect(isDualTrackEconomy("RU", 1979, true)).toBe(true);
  });
});

describe("byte-identical when the flag is OFF", () => {
  it("predicates ignore any stored level and return the disabled defaults", () => {
    setStoredMarketizationLevel("RU", 5); // deep command
    expect(isCommandEconomy("RU", 1979, false)).toBe(false);
    expect(isDualTrackEconomy("RU", 1979, false)).toBe(false);
    expect(isPlannedEconomy("RU", 1979, false)).toBe(false);
    expect(plannedShare("RU", 1979, false)).toBe(0);
  });
});

describe("commandEconomySoeSectors", () => {
  it("RU has a full-sector SOE set", () => {
    expect(commandEconomySoeSectors("RU").length).toBeGreaterThan(0);
    expect(commandEconomySoeSectors("RU")).toContain("energy");
    expect(commandEconomySoeSectors("RU")).toContain("retail");
  });
  it("a market country has no SOE set", () => {
    expect(commandEconomySoeSectors("US")).toEqual([]);
    expect(commandEconomySoeSectors(null)).toEqual([]);
  });
});
