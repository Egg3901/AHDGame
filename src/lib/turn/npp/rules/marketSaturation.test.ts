import { describe, it, expect } from "vitest";
import {
  buildMarketSaturationIndex,
  isMarketSaturated,
  isStuckAtThrottleFloor,
  marketSaturationOf,
  NPP_FLOOR_MOTHBALL_TURNS,
} from "./marketSaturation";
import { NPP_GROWTH_MIN_THROTTLE } from "../nppCorporationTuning";

const plant = (over: Record<string, unknown> = {}) => ({
  stateId: "TN",
  sectorType: "logistics",
  capitalStock: 100,
  demandThrottleFactor: 1,
  ...over,
});

describe("marketSaturationOf", () => {
  it("is the capacity-weighted throttle of the cell", () => {
    const index = buildMarketSaturationIndex([
      plant({ capitalStock: 300, demandThrottleFactor: 0.1 }),
      plant({ capitalStock: 100, demandThrottleFactor: 0.9 }),
    ]);
    expect(marketSaturationOf(index, { stateId: "TN", sectorType: "logistics" })).toBeCloseTo(
      0.3,
      10
    );
  });

  it("counts mothballed capacity at zero", () => {
    const index = buildMarketSaturationIndex([
      plant({ capitalStock: 100, demandThrottleFactor: 1 }),
      plant({ capitalStock: 100, demandThrottleFactor: 1, mothballed: true }),
    ]);
    expect(marketSaturationOf(index, { stateId: "TN", sectorType: "logistics" })).toBeCloseTo(
      0.5,
      10
    );
  });

  it("has no evidence without capacity carrying a reading", () => {
    const index = buildMarketSaturationIndex([
      plant({ capitalStock: 0, demandThrottleFactor: 0.1 }),
      plant({ demandThrottleFactor: null }),
    ]);
    expect(marketSaturationOf(index, { stateId: "TN", sectorType: "logistics" })).toBeNull();
    expect(marketSaturationOf(index, { stateId: "ME", sectorType: "logistics" })).toBeNull();
  });

  it("keys lanes apart, so an entertainment glut does not block news", () => {
    const index = buildMarketSaturationIndex([
      plant({
        sectorType: "media",
        mediaDiscriminator: "entertainment",
        demandThrottleFactor: 0.1,
      }),
    ]);
    expect(
      marketSaturationOf(index, {
        stateId: "TN",
        sectorType: "media",
        mediaDiscriminator: "entertainment",
      })
    ).toBeCloseTo(0.1, 10);
    expect(
      marketSaturationOf(index, { stateId: "TN", sectorType: "media", mediaDiscriminator: "news" })
    ).toBeNull();
  });

  it("judges a plant on its rivals when excluding itself", () => {
    const self = plant({ capitalStock: 900, mothballed: true });
    const index = buildMarketSaturationIndex([self, plant({ demandThrottleFactor: 0.9 })]);
    expect(marketSaturationOf(index, self)).toBeCloseTo(0.09, 10);
    expect(marketSaturationOf(index, self, self)).toBeCloseTo(0.9, 10);
    const alone = buildMarketSaturationIndex([self]);
    expect(marketSaturationOf(alone, self, self)).toBeNull();
  });
});

describe("isMarketSaturated", () => {
  it("blocks below the incumbent growth bar and never on missing evidence", () => {
    expect(isMarketSaturated(0.3)).toBe(true);
    // A cell idle retirement has settled at 1 / (1 + 0.25) is full, not open.
    expect(isMarketSaturated(0.8)).toBe(true);
    expect(isMarketSaturated(NPP_GROWTH_MIN_THROTTLE)).toBe(false);
    expect(isMarketSaturated(null)).toBe(false);
    expect(isMarketSaturated(Number.NaN)).toBe(false);
  });
});

describe("isStuckAtThrottleFloor", () => {
  it("needs both a deep throttle and the sustained streak", () => {
    expect(
      isStuckAtThrottleFloor({
        demandThrottleFactor: 0.1,
        demandIdleTurns: NPP_FLOOR_MOTHBALL_TURNS,
      })
    ).toBe(true);
    expect(
      isStuckAtThrottleFloor({
        demandThrottleFactor: 0.1,
        demandIdleTurns: NPP_FLOOR_MOTHBALL_TURNS - 1,
      })
    ).toBe(false);
    expect(isStuckAtThrottleFloor({ demandThrottleFactor: 0.3, demandIdleTurns: 50 })).toBe(false);
    expect(isStuckAtThrottleFloor({ demandThrottleFactor: 0.1 })).toBe(false);
  });
});
