import { describe, expect, it } from "vitest";
import { fieldOfficeRamp, fieldOfficeRegionEffect, fieldOfficeYield } from "./effects";
import { FIELD_OFFICE_RAMP_TURNS, getFieldOfficeRules, getFieldOfficeScope } from "./rules";

const county = getFieldOfficeRules("US")!;
const region = getFieldOfficeRules("UK")!;

describe("field office scope registry", () => {
  it("maps US to counties and UK / JP to regions", () => {
    expect(getFieldOfficeScope("US")).toBe("county");
    expect(getFieldOfficeScope("UK")).toBe("region");
    expect(getFieldOfficeScope("JP")).toBe("region");
  });
  it("leaves countries without a scope off", () => {
    expect(getFieldOfficeScope("DE")).toBeNull();
    expect(getFieldOfficeRules("NOPE")).toBeNull();
  });
});

describe("fieldOfficeRamp", () => {
  it("ramps linearly to full strength, starting the turn it opens", () => {
    expect(fieldOfficeRamp(10, 9)).toBe(0);
    expect(fieldOfficeRamp(10, 10)).toBeCloseTo(1 / FIELD_OFFICE_RAMP_TURNS);
    expect(fieldOfficeRamp(10, 10 + FIELD_OFFICE_RAMP_TURNS - 1)).toBe(1);
    expect(fieldOfficeRamp(10, 50)).toBe(1);
  });
});

describe("fieldOfficeRegionEffect", () => {
  const mature = (electorateShare: number, yieldFactor = 1) => ({
    openedTurn: 0,
    electorateShare,
    yieldFactor,
  });

  it("is neutral with no offices", () => {
    expect(fieldOfficeRegionEffect([], county, 10).multiplier).toBe(1);
  });

  it("saturates the regional term toward its cap", () => {
    const many = Array.from({ length: 40 }, () => mature(0));
    const eff = fieldOfficeRegionEffect(many, county, 10);
    expect(eff.regionalPct).toBeLessThanOrEqual(county.regionCapPct);
    expect(eff.regionalPct).toBeGreaterThan(county.regionCapPct * 0.99);
    const one = fieldOfficeRegionEffect([mature(0)], county, 10).regionalPct;
    const two = fieldOfficeRegionEffect([mature(0), mature(0)], county, 10).regionalPct;
    expect(two - one).toBeLessThan(one);
  });

  it("scales the local term by county size and yield", () => {
    const small = fieldOfficeRegionEffect([mature(0.02)], county, 10).localPct;
    const big = fieldOfficeRegionEffect([mature(0.2)], county, 10).localPct;
    const bigFriendly = fieldOfficeRegionEffect([mature(0.2, 1.5)], county, 10).localPct;
    expect(big).toBeCloseTo(small * 10);
    expect(bigFriendly).toBeCloseTo(big * 1.5);
  });

  it("gives region scope no local term and a smaller cap", () => {
    const eff = fieldOfficeRegionEffect([mature(0.5), mature(0.5), mature(0.5)], region, 10);
    expect(eff.localPct).toBe(0);
    expect(eff.regionalPct).toBeLessThan(region.regionCapPct);
    expect(region.regionCapPct).toBeLessThan(county.regionCapPct);
  });

  it("counts a fresh office at a fraction of its strength", () => {
    const fresh = fieldOfficeRegionEffect([{ openedTurn: 10, electorateShare: 0.1 }], county, 10);
    const full = fieldOfficeRegionEffect([{ openedTurn: 0, electorateShare: 0.1 }], county, 10);
    expect(fresh.localPct).toBeCloseTo(full.localPct / FIELD_OFFICE_RAMP_TURNS);
  });
});

describe("fieldOfficeYield", () => {
  it("rewards organising where your side is stronger than the state", () => {
    expect(fieldOfficeYield(1, 15)).toBeGreaterThan(1);
    expect(fieldOfficeYield(-1, 15)).toBeLessThan(1);
    expect(fieldOfficeYield(-1, -15)).toBeGreaterThan(1);
  });
  it("is flat for centrists and clamps at the extremes", () => {
    expect(fieldOfficeYield(0, 40)).toBe(1);
    expect(fieldOfficeYield(1, 400)).toBe(1.75);
    expect(fieldOfficeYield(1, -400)).toBe(0.25);
  });
});
