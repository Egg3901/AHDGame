import { describe, it, expect } from "vitest";
import { COUNTRY_READINESS_EXPECTATIONS } from "./countryReadinessExpectations";

describe("COUNTRY_READINESS_EXPECTATIONS.IE", () => {
  const ie = COUNTRY_READINESS_EXPECTATIONS.IE;

  it("is defined", () => {
    expect(ie).toBeDefined();
  });

  it("expects 8 NUTS-III planning regions", () => {
    expect(ie!.regionCount).toBe(8);
    expect(ie!.demographicsCount).toBe(8);
    expect(ie!.stateMetricsCount).toBe(8);
  });

  it("expects at least 5 default IE parties", () => {
    expect(ie!.partyMin).toBeGreaterThanOrEqual(5);
    expect(ie!.partyRoster).toContain("Fine Gael");
    expect(ie!.partyRoster).toContain("Fianna Fáil");
  });

  it("expects at least 160 Dáil seats", () => {
    expect(ie!.seatMin).toBeGreaterThanOrEqual(160);
  });

  it("expects at least 50 IE legislation types", () => {
    expect(ie!.legislationTypesMin).toBeGreaterThanOrEqual(50);
  });

  it("registers a governmentFormations readiness extra", () => {
    expect(ie!.extras).toBeDefined();
    expect(ie!.extras!).toHaveLength(1);
  });

  it("filters stateMetrics by countryId 'IE'", () => {
    expect(ie!.stateMetricsFilter).toEqual({ countryId: "IE" });
  });

  it("expects 40 statePartyOrg rows post Phase 9 (8 regions × 5 default parties)", () => {
    expect(ie!.statePartyOrgMin).toBe(40);
  });

  it("leaves nppMin / officialMin at 0 — historical NPP / official seeding is bootstrap-driven", () => {
    // Historical NPP / official seeding via IE_DAIL_2020 happens during
    // bootstrap; the readiness gate stays permissive here so a fresh
    // run-time count doesn't false-negative.
    expect(ie!.nppMin).toBe(0);
    expect(ie!.officialMin).toBe(0);
  });
});
