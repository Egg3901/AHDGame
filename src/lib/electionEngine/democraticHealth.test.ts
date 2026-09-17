import { describe, expect, it } from "vitest";
import {
  democraticHealthMultiplierForCandidate,
  democraticHealthPressure,
  DEMOCRATIC_HEALTH_PARTY_PENALTY_MAX,
  DEMOCRATIC_HEALTH_RELIEF_CAP_PCT,
} from "./democraticHealth";

describe("democratic health pressure", () => {
  it("stays neutral until democratic health begins to falter", () => {
    expect(democraticHealthPressure(60)).toEqual({
      value: 60,
      severity: 0,
      partyPenalty: 0,
      currentRulerPenalty: 0,
      reliefPct: 0,
    });
  });

  it("gets progressively harsher as health falls", () => {
    const at45 = democraticHealthPressure(45);
    const at30 = democraticHealthPressure(30);
    const at0 = democraticHealthPressure(0);

    expect(at45.partyPenalty).toBeGreaterThan(0);
    expect(at30.partyPenalty).toBeGreaterThan(at45.partyPenalty);
    expect(at0.partyPenalty).toBe(DEMOCRATIC_HEALTH_PARTY_PENALTY_MAX);
    expect(at0.currentRulerPenalty).toBeGreaterThan(at0.partyPenalty);
  });

  it("limits temporary relief to the additional sitting-ruler drag", () => {
    const withoutRelief = democraticHealthPressure(30);
    const withRelief = democraticHealthPressure(30, 50);
    const fullyCapped = democraticHealthPressure(0, 100);

    expect(withRelief.partyPenalty).toBe(withoutRelief.partyPenalty);
    expect(withRelief.currentRulerPenalty).toBeLessThan(withoutRelief.currentRulerPenalty);
    expect(withRelief.currentRulerPenalty).toBeGreaterThan(withRelief.partyPenalty);
    expect(fullyCapped.reliefPct).toBe(DEMOCRATIC_HEALTH_RELIEF_CAP_PCT);
    expect(fullyCapped.currentRulerPenalty).toBeGreaterThan(fullyCapped.partyPenalty);
  });
});

describe("democratic health candidate multiplier", () => {
  const pressure = democraticHealthPressure(30);

  it("penalizes every candidate from the ruling party", () => {
    expect(
      democraticHealthMultiplierForCandidate({
        candidateParty: "ruling",
        rulingPartyId: "ruling",
        partyPenalty: pressure.partyPenalty,
        currentRulerPenalty: pressure.currentRulerPenalty,
      })
    ).toBeCloseTo(1 - pressure.partyPenalty, 8);
  });

  it("adds the larger drag only to the current ruler", () => {
    expect(
      democraticHealthMultiplierForCandidate({
        candidateParty: "ruling",
        candidateCharacterId: "president",
        rulingPartyId: "ruling",
        currentRulerCharacterId: "president",
        partyPenalty: pressure.partyPenalty,
        currentRulerPenalty: pressure.currentRulerPenalty,
      })
    ).toBeCloseTo(1 - pressure.currentRulerPenalty, 8);
  });

  it("leaves opposition candidates neutral", () => {
    expect(
      democraticHealthMultiplierForCandidate({
        candidateParty: "opposition",
        rulingPartyId: "ruling",
        partyPenalty: pressure.partyPenalty,
        currentRulerPenalty: pressure.currentRulerPenalty,
      })
    ).toBe(1);
  });
});
