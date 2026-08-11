import { describe, it, expect } from "vitest";
import { getBaseAffinity, computeAffinity } from "./affinity";
import {
  TRADE_BASE_AFFINITY_DEFAULT,
  TRADE_FTA_AFFINITY_BONUS,
  TRADE_BLOC_AFFINITY_BONUS,
} from "./constants";
import type { AffinityInputs } from "./types";

const base: AffinityInputs = {
  exporter: "US",
  importer: "CN",
  commodity: "steel",
  ftaCovered: false,
  sharedBloc: false,
  importerTariffRate: 0,
  blocked: false,
};

describe("getBaseAffinity", () => {
  it("returns the default for a pair with no override", () => {
    expect(getBaseAffinity("US", "JP")).toBeCloseTo(1.3); // JP-US override
    expect(getBaseAffinity("US", "DE")).toBe(TRADE_BASE_AFFINITY_DEFAULT);
  });

  it("is symmetric (order independent)", () => {
    expect(getBaseAffinity("IE", "UK")).toBe(getBaseAffinity("UK", "IE"));
    expect(getBaseAffinity("CN", "US")).toBeCloseTo(1.5);
  });

  it("gives Yugoslavia a mild Western trade lean vs Soviet-bloc default", () => {
    // Post–Tito–Stalin split US/UK aid and Adriatic trade — YU only exists in
    // Cold-War presets, so these overrides are inert on modern worlds.
    expect(getBaseAffinity("US", "YU")).toBeCloseTo(1.35);
    expect(getBaseAffinity("YU", "US")).toBeCloseTo(1.35);
    expect(getBaseAffinity("UK", "YU")).toBeCloseTo(1.25);
    expect(getBaseAffinity("US", "HU")).toBe(TRADE_BASE_AFFINITY_DEFAULT);
  });
});

describe("computeAffinity", () => {
  it("returns the base affinity when no modifiers apply", () => {
    expect(computeAffinity(base)).toBeCloseTo(getBaseAffinity("US", "CN"));
  });

  it("returns 0 when the pair is blocked", () => {
    expect(computeAffinity({ ...base, blocked: true })).toBe(0);
  });

  it("multiplies by the FTA bonus when covered", () => {
    const v = computeAffinity({ ...base, ftaCovered: true });
    expect(v).toBeCloseTo(getBaseAffinity("US", "CN") * TRADE_FTA_AFFINITY_BONUS);
  });

  it("multiplies by the bloc bonus when shared", () => {
    const v = computeAffinity({ ...base, sharedBloc: true });
    expect(v).toBeCloseTo(getBaseAffinity("US", "CN") * TRADE_BLOC_AFFINITY_BONUS);
  });

  it("drags affinity down as the importer tariff rises", () => {
    const noTariff = computeAffinity(base);
    const withTariff = computeAffinity({ ...base, importerTariffRate: 0.2 });
    expect(withTariff).toBeLessThan(noTariff);
    // drag = 1/(1 + 3 × 0.2) = 0.625
    expect(withTariff).toBeCloseTo(noTariff * 0.625);
  });

  it("treats negative/NaN tariff as zero drag", () => {
    expect(computeAffinity({ ...base, importerTariffRate: -1 })).toBeCloseTo(computeAffinity(base));
    expect(computeAffinity({ ...base, importerTariffRate: NaN })).toBeCloseTo(
      computeAffinity(base)
    );
  });
});
