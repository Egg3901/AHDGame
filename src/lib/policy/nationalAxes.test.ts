import { describe, expect, it } from "vitest";
import { computeDomainAxes, computeNationalAxes, type AxisInputRecord } from "./nationalAxes";

function policy(partial: Partial<AxisInputRecord>): AxisInputRecord {
  return {
    recordType: "policy",
    economic: 0,
    social: 0,
    hasEconomic: false,
    hasSocial: false,
    ...partial,
  };
}

describe("computeNationalAxes", () => {
  it("returns nulls and zero counts for an empty record set", () => {
    expect(computeNationalAxes([])).toEqual({
      economic: null,
      social: null,
      lawCount: 0,
      economicCount: 0,
      socialCount: 0,
    });
  });

  it("equal-weight means each axis independently", () => {
    const result = computeNationalAxes([
      policy({ economic: -3, hasEconomic: true }),
      policy({ economic: -2, hasEconomic: true, social: 1, hasSocial: true }),
      policy({ social: -3, hasSocial: true }),
    ]);
    expect(result.economic).toBeCloseTo(-2.5);
    expect(result.social).toBeCloseTo(-1);
    expect(result.lawCount).toBe(3);
    expect(result.economicCount).toBe(2);
    expect(result.socialCount).toBe(2);
  });

  it("counts an explicit 0 on an applicable axis and excludes missing axes", () => {
    const result = computeNationalAxes([
      policy({ economic: 0, hasEconomic: true }), // genuine centrist law
      policy({ economic: -4, hasEconomic: true }),
      policy({ social: 2, hasSocial: true }), // no economic position — excluded from econ
    ]);
    expect(result.economic).toBeCloseTo(-2); // (0 + -4) / 2, NOT -4/1 or -4/3
    expect(result.economicCount).toBe(2);
  });

  it("returns per-axis null when no law carries that axis", () => {
    const result = computeNationalAxes([policy({ economic: 1, hasEconomic: true })]);
    expect(result.social).toBeNull();
    expect(result.socialCount).toBe(0);
  });

  it("ignores tariff and subsidy records entirely", () => {
    const result = computeNationalAxes([
      policy({ economic: -1, hasEconomic: true }),
      { recordType: "tariff", economic: 5, social: 5, hasEconomic: true, hasSocial: true },
      { recordType: "subsidy", economic: 5, social: 5, hasEconomic: true, hasSocial: true },
    ]);
    expect(result.economic).toBeCloseTo(-1);
    expect(result.lawCount).toBe(1);
  });

  it("clamps results to the −5…+5 axis range", () => {
    const result = computeNationalAxes([policy({ economic: -7, hasEconomic: true })]);
    expect(result.economic).toBe(-5);
  });

  it("excludes policy records that carry no axis at all from lawCount", () => {
    const result = computeNationalAxes([policy({})]);
    expect(result.lawCount).toBe(0);
  });

  it("treats records without a recordType as policy records (API marks it optional)", () => {
    const result = computeNationalAxes([
      { economic: -2, social: 0, hasEconomic: true, hasSocial: false },
    ]);
    expect(result.economic).toBeCloseTo(-2);
    expect(result.lawCount).toBe(1);
  });
});

describe("computeDomainAxes", () => {
  it("groups records by policyDomain and averages each group independently", () => {
    const result = computeDomainAxes([
      policy({ policyDomain: "tax", economic: -2, hasEconomic: true }),
      policy({ policyDomain: "tax", economic: -1, hasEconomic: true }),
      policy({ policyDomain: "immigration", social: 2, hasSocial: true }),
    ]);
    expect(result.get("tax")?.economic).toBeCloseTo(-1.5);
    expect(result.get("tax")?.lawCount).toBe(2);
    expect(result.get("immigration")?.social).toBeCloseTo(2);
  });

  it("falls back to the governance domain when policyDomain is missing", () => {
    const result = computeDomainAxes([policy({ economic: 1, hasEconomic: true })]);
    expect(result.get("governance")?.economic).toBeCloseTo(1);
  });

  it("keeps axis-less domains with per-axis nulls (drives the muted track)", () => {
    const result = computeDomainAxes([
      {
        recordType: "tariff",
        economic: 0,
        social: 0,
        hasEconomic: false,
        hasSocial: false,
        policyDomain: "trade",
      },
      policy({ policyDomain: "trade" }),
    ]);
    const trade = result.get("trade");
    expect(trade).toBeDefined();
    expect(trade?.economic).toBeNull();
    expect(trade?.social).toBeNull();
    expect(trade?.lawCount).toBe(0);
  });
});
