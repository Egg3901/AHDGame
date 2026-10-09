import { describe, expect, it, vi } from "vitest";
import {
  computeFractionalRateUpdate,
  computeRateUpdate,
  fractionalRateStep,
  type MacroInputs,
  type VolumeInputs,
} from "./rateCalculation";
import { CYCLE_PRESSURE_BY_REGIME, DRIFT_SPEED } from "@/lib/constants/currencies";
import { BW_FLOATING_DRIFT_MULTIPLIER } from "@/lib/monetary/brettonWoods";
import { fractionalAlpha } from "@/lib/turn/subhour/stepFraction";

// Off-neutral inputs so drift, volume and cycle pressure all act at once.
const macro: MacroInputs = { primeRate: 4.5, inflationRate: 3.2, gdpGrowth: 0.4, tradeGrowth: 1 };
const volumes: VolumeInputs = { buyVolume24: 2_000_000, sellVolume24: 300_000 };
const cycle = CYCLE_PRESSURE_BY_REGIME.moderate_weaken;
const band = 0.8;

function halves(rate: number, base: number, driftMultiplier = 1) {
  const first = computeFractionalRateUpdate(
    rate,
    base,
    "UK",
    macro,
    volumes,
    0.5,
    0,
    1,
    cycle,
    2019,
    band,
    driftMultiplier
  );
  return computeFractionalRateUpdate(
    first.rate,
    base,
    "UK",
    macro,
    volumes,
    0.5,
    0,
    1,
    cycle,
    2019,
    band,
    driftMultiplier
  );
}

describe("fractionalRateStep", () => {
  it("reduces to fractionalAlpha drift with no pressure", () => {
    const f = 0.3;
    const expected = 1 + (2 - 1) * fractionalAlpha(DRIFT_SPEED, f);
    expect(fractionalRateStep(1, 2, DRIFT_SPEED, 1, f)).toBeCloseTo(expected, 14);
  });

  it("reduces to (1 - p)^f with no drift", () => {
    expect(fractionalRateStep(3, 9, 0, 0.98, 0.5)).toBeCloseTo(3 * Math.pow(0.98, 0.5), 14);
  });

  it("composes: f then 1 - f equals one full step, drift and pressure together", () => {
    for (const f of [0.25, 0.5, 0.75]) {
      const full = fractionalRateStep(1.3, 0.9, 0.05, 0.993, 1);
      const split = fractionalRateStep(
        fractionalRateStep(1.3, 0.9, 0.05, 0.993, f),
        0.9,
        0.05,
        0.993,
        1 - f
      );
      expect(split).toBeCloseTo(full, 13);
      expect(full).toBeCloseTo(0.993 * (1.3 + (0.9 - 1.3) * 0.05), 14);
    }
  });

  it("is the identity at f = 0", () => {
    expect(fractionalRateStep(1.3, 0.9, 0.05, 0.993, 0)).toBe(1.3);
  });
});

describe("computeFractionalRateUpdate", () => {
  it("is exactly computeRateUpdate at fraction 1", () => {
    const args = [0.8, 0.75, "UK", macro, volumes] as const;
    expect(computeFractionalRateUpdate(...args, 1, 0.002, 0.5, cycle, 2019, band, 2)).toEqual(
      computeRateUpdate(...args, 0.002, 0.5, cycle, 2019, band, 2)
    );
  });

  it("two noiseless halves compose to one noiseless full step", () => {
    const full = computeRateUpdate(0.8, 0.75, "UK", macro, volumes, 0, 1, cycle, 2019, band, 1);
    expect(halves(0.8, 0.75).rate).toBeCloseTo(full.rate, 13);
    expect(halves(0.8, 0.75).macroTarget).toBe(full.macroTarget);
  });

  it("composes under the Bretton Woods float drift multiplier", () => {
    const full = computeRateUpdate(
      0.8,
      0.75,
      "UK",
      macro,
      volumes,
      0,
      1,
      cycle,
      2019,
      band,
      BW_FLOATING_DRIFT_MULTIPLIER
    );
    expect(halves(0.8, 0.75, BW_FLOATING_DRIFT_MULTIPLIER).rate).toBeCloseTo(full.rate, 13);
  });

  it("clamps each part to the band", () => {
    const r = computeFractionalRateUpdate(5, 0.75, "UK", macro, volumes, 0.5, 0, 1, 0, 2019, 0.5);
    expect(r.rate).toBe(0.75 * 1.5);
  });

  it("scales noise by sqrt(fraction)", () => {
    const n = 0.003;
    const quiet = computeFractionalRateUpdate(0.8, 0.75, "UK", macro, volumes, 0.5, 0, 0.5);
    const noisy = computeFractionalRateUpdate(0.8, 0.75, "UK", macro, volumes, 0.5, n, 0.5);
    expect(noisy.rate / quiet.rate - 1).toBeCloseTo(n * Math.SQRT1_2 * 0.5, 14);
  });

  it("keeps hourly noise variance: two half-hour draws add up to one hourly draw", () => {
    // Seeded draws: a statistical bound on unseeded Math.random fails now and then.
    let seed = 0x2545f491;
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 4294967296;
    });
    const samples = 20_000;
    const jitter = (fraction: number) => {
      const quiet = computeFractionalRateUpdate(0.8, 0.75, "UK", macro, volumes, fraction, 0);
      const draws: number[] = [];
      for (let i = 0; i < samples; i++) {
        draws.push(
          computeFractionalRateUpdate(0.8, 0.75, "UK", macro, volumes, fraction).rate / quiet.rate -
            1
        );
      }
      const mean = draws.reduce((s, x) => s + x, 0) / samples;
      return draws.reduce((s, x) => s + (x - mean) ** 2, 0) / (samples - 1);
    };
    const hourly = jitter(1);
    const half = jitter(0.5);
    // Uniform +/-0.004 has variance 0.004^2 / 3.
    expect(hourly).toBeCloseTo(0.004 ** 2 / 3, 7);
    expect((2 * half) / hourly).toBeGreaterThan(0.95);
    expect((2 * half) / hourly).toBeLessThan(1.05);
    random.mockRestore();
  });
});
