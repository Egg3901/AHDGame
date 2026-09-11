import { describe, expect, it } from "vitest";
import {
  DEMOCRATIC_HEALTH_RELIEF_CAP_PCT,
  sumActivePresidentialHealthReliefPct,
  sumActiveSectorDemandModifierPct,
  sumActiveWarEmergencyMitigationPct,
  WAR_EMERGENCY_MITIGATION_CAP_PCT,
} from "./countryModifiers";

describe("sumActiveSectorDemandModifierPct", () => {
  const modifiers = [
    { sectorType: "construction", pct: 5, expiresAtTurn: 20 },
    { sectorType: "construction", pct: 3, expiresAtTurn: 25 },
    { sectorType: "tourism", pct: 8, expiresAtTurn: 20 },
    { sectorType: "construction", pct: 10, expiresAtTurn: 10 },
  ];

  it("sums pct across active modifiers matching sectorType", () => {
    expect(sumActiveSectorDemandModifierPct(modifiers, "construction", 15)).toBe(8);
  });

  it("excludes modifiers that have expired by currentTurn (expiresAtTurn <= currentTurn)", () => {
    expect(sumActiveSectorDemandModifierPct(modifiers, "construction", 20)).toBe(3);
    expect(sumActiveSectorDemandModifierPct(modifiers, "construction", 25)).toBe(0);
  });

  it("ignores modifiers for other sector types", () => {
    expect(sumActiveSectorDemandModifierPct(modifiers, "tourism", 15)).toBe(8);
  });

  it("returns 0 when no modifiers match", () => {
    expect(sumActiveSectorDemandModifierPct(modifiers, "extraction", 15)).toBe(0);
  });

  it("returns 0 for an empty modifier list", () => {
    expect(sumActiveSectorDemandModifierPct([], "construction", 15)).toBe(0);
  });
});

describe("sumActiveWarEmergencyMitigationPct", () => {
  it("stacks active measures, ignores expired ones, and preserves a residual crisis cadence", () => {
    expect(
      sumActiveWarEmergencyMitigationPct(
        [
          { pct: 18, expiresAtTurn: 120 },
          { pct: 14, expiresAtTurn: 130 },
          { pct: 30, expiresAtTurn: 99 },
          { pct: 20, expiresAtTurn: 140 },
        ],
        100
      )
    ).toBe(WAR_EMERGENCY_MITIGATION_CAP_PCT);
  });
});

describe("sumActivePresidentialHealthReliefPct", () => {
  it("matches the current ruler, ignores expired relief, and caps the stack", () => {
    expect(
      sumActivePresidentialHealthReliefPct(
        [
          { partyId: "ruling", characterId: "pres", pct: 40, expiresAtTurn: 120 },
          { partyId: "ruling", characterId: "pres", pct: 50, expiresAtTurn: 130 },
          { partyId: "ruling", characterId: "other", pct: 50, expiresAtTurn: 130 },
          { partyId: "ruling", characterId: "pres", pct: 50, expiresAtTurn: 100 },
        ],
        "ruling",
        "pres",
        110
      )
    ).toBe(DEMOCRATIC_HEALTH_RELIEF_CAP_PCT);
  });
});
