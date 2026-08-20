import { describe, it, expect } from "vitest";
import { SHARE_EXECUTION_PRICE_BAND_MAX_RATIO } from "@/lib/constants/corporations";
import {
  isWithinShareExecutionBand,
  resolveShareExecutionPrice,
  shareExecutionPriceBand,
} from "./marketExecution";

const K = SHARE_EXECUTION_PRICE_BAND_MAX_RATIO;

describe("shareExecutionPriceBand", () => {
  it("anchors on fundamentalSharePrice in both directions", () => {
    const band = shareExecutionPriceBand({ fundamentalSharePrice: 12 });
    expect(band).toEqual({ min: 12 / K, max: 12 * K });
  });

  it("returns null with no positive fundamental to anchor on", () => {
    expect(shareExecutionPriceBand({ fundamentalSharePrice: 0 })).toBeNull();
    expect(shareExecutionPriceBand({ fundamentalSharePrice: undefined })).toBeNull();
    expect(shareExecutionPriceBand({ fundamentalSharePrice: Number.NaN })).toBeNull();
  });
});

describe("isWithinShareExecutionBand", () => {
  it("rejects limit prices wildly off fundamental (incident: limit_fill at 118 vs ~12)", () => {
    expect(isWithinShareExecutionBand({ fundamentalSharePrice: 12 }, 118)).toBe(false);
    expect(isWithinShareExecutionBand({ fundamentalSharePrice: 12 }, 1)).toBe(false);
  });

  it("accepts prices inside the band, and everything when no band exists", () => {
    expect(isWithinShareExecutionBand({ fundamentalSharePrice: 12 }, 30)).toBe(true);
    expect(isWithinShareExecutionBand({ fundamentalSharePrice: 0 }, 118)).toBe(true);
  });
});

describe("resolveShareExecutionPrice band clamp", () => {
  const corp = (over: Partial<Parameters<typeof resolveShareExecutionPrice>[0]>) => ({
    fundamentalSharePrice: 12,
    publicFloat: 500_000,
    totalShares: 1_000_000, // 50% float: order-flow eligible, live price applies
    sharePrice: 12,
    ...over,
  });

  it("clamps a pumped live price to K x fundamental", () => {
    expect(resolveShareExecutionPrice(corp({ sharePrice: 3158 }))).toBe(12 * K);
  });

  it("clamps a crashed live price to fundamental / K", () => {
    expect(resolveShareExecutionPrice(corp({ sharePrice: 0.01 }))).toBe(12 / K);
  });

  it("passes an in-band live price through untouched", () => {
    expect(resolveShareExecutionPrice(corp({ sharePrice: 14.5 }))).toBe(14.5);
  });

  it("still falls back to fundamental for concentrated floats", () => {
    // Float below MIN_ORDER_FLOW_FLOAT_FRACTION: pre-existing tiny-float rule.
    expect(resolveShareExecutionPrice(corp({ publicFloat: 10_000, sharePrice: 3158 }))).toBe(12);
  });

  it("executes unclamped when the corp has no fundamental", () => {
    expect(resolveShareExecutionPrice(corp({ fundamentalSharePrice: 0, sharePrice: 42 }))).toBe(42);
  });
});
