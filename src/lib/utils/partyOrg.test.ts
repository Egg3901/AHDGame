import { describe, it, expect } from "vitest";
import {
  getOrgLabel,
  getOrgBarColor,
  calculateInitialOrg,
  validateOrganization,
} from "@/lib/utils/partyOrg";

describe("getOrgLabel", () => {
  it("returns Dominant for org >= 90", () => {
    expect(getOrgLabel(90).label).toBe("Dominant");
    expect(getOrgLabel(100).label).toBe("Dominant");
  });

  it("returns Strong for org >= 70", () => {
    expect(getOrgLabel(70).label).toBe("Strong");
    expect(getOrgLabel(89).label).toBe("Strong");
  });

  it("returns Competitive for org >= 50", () => {
    expect(getOrgLabel(50).label).toBe("Competitive");
  });

  it("returns Developing for org >= 30", () => {
    expect(getOrgLabel(30).label).toBe("Developing");
  });

  it("returns Weak for org >= 10", () => {
    expect(getOrgLabel(10).label).toBe("Weak");
  });

  it("returns Minimal for org < 10", () => {
    expect(getOrgLabel(0).label).toBe("Minimal");
    expect(getOrgLabel(9).label).toBe("Minimal");
  });
});

describe("getOrgBarColor", () => {
  it("returns green for org >= 70", () => {
    expect(getOrgBarColor(70)).toContain("green");
  });

  it("returns yellow for org >= 50", () => {
    expect(getOrgBarColor(50)).toContain("yellow");
  });

  it("returns orange for org >= 30", () => {
    expect(getOrgBarColor(30)).toContain("orange");
  });

  it("returns red for org < 30", () => {
    expect(getOrgBarColor(0)).toContain("red");
  });
});

describe("calculateInitialOrg", () => {
  it("returns 25 for us_democrat in swing state (lean 0)", () => {
    expect(calculateInitialOrg(0, "democrat")).toBe(25);
  });

  it("returns 60 for us_democrat in solid blue state (lean -5)", () => {
    expect(calculateInitialOrg(-5, "democrat")).toBe(60);
  });

  it("returns 60 for us_republican in solid red state (lean +5)", () => {
    expect(calculateInitialOrg(5, "republican")).toBe(60);
  });

  it("returns 0 for third parties", () => {
    expect(calculateInitialOrg(0, "independent")).toBe(0);
  });
});

describe("validateOrganization", () => {
  it("returns true for valid org 0-100", () => {
    expect(validateOrganization(0)).toBe(true);
    expect(validateOrganization(50)).toBe(true);
    expect(validateOrganization(100)).toBe(true);
  });

  it("returns false for out of range", () => {
    expect(validateOrganization(-1)).toBe(false);
    expect(validateOrganization(101)).toBe(false);
  });
});
