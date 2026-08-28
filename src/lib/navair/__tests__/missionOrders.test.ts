import { describe, it, expect } from "vitest";
import {
  isMissionValidFor,
  missionNeedsTarget,
  NAVAL_MISSIONS_ORDERABLE,
  AIR_MISSIONS_ORDERABLE,
} from "../missions";
import { NAVAL_MISSIONS, AIR_MISSIONS } from "../config";

/**
 * Order validation.
 *
 * These guard a specific silent failure: a naval formation given an air mission falls
 * through `navalPosture` to the flying-weights fallback and fights at half value forever,
 * with nothing in the interface to say why. It has to be rejected at the boundary, not
 * discovered later as a balance mystery.
 */

describe("isMissionValidFor", () => {
  it("accepts every naval posture for a naval formation", () => {
    for (const m of NAVAL_MISSIONS_ORDERABLE) {
      expect(isMissionValidFor("naval", m)).toBe(true);
    }
  });

  it("accepts every air mission for an air formation", () => {
    for (const m of AIR_MISSIONS_ORDERABLE) {
      expect(isMissionValidFor("air", m)).toBe(true);
    }
  });

  it("refuses an air mission for a naval formation", () => {
    expect(isMissionValidFor("naval", "CAS")).toBe(false);
    expect(isMissionValidFor("naval", "CAP")).toBe(false);
  });

  it("refuses a naval posture for an air formation", () => {
    expect(isMissionValidFor("air", "BLOCKADE")).toBe(false);
    expect(isMissionValidFor("air", "SEA_DENIAL")).toBe(false);
  });

  it("refuses anything for a domain this subsystem does not command", () => {
    expect(isMissionValidFor("ground", "CAS")).toBe(false);
    expect(isMissionValidFor("rocket", "BLOCKADE")).toBe(false);
  });

  it("refuses an unknown mission string", () => {
    expect(isMissionValidFor("naval", "ATTACK")).toBe(false);
    expect(isMissionValidFor("air", "")).toBe(false);
  });

  it("stays in step with the tuning tables", () => {
    // If a posture is added to config without being added to the orderable list, players
    // could never be given it, and the mismatch would be invisible.
    expect([...NAVAL_MISSIONS_ORDERABLE].sort()).toEqual(Object.keys(NAVAL_MISSIONS).sort());
    expect([...AIR_MISSIONS_ORDERABLE].sort()).toEqual(Object.keys(AIR_MISSIONS).sort());
  });
});

describe("missionNeedsTarget", () => {
  it("requires a target for strikes", () => {
    expect(missionNeedsTarget("STRIKE_NAVAL")).toBe(true);
    expect(missionNeedsTarget("STRIKE_AIRBASE")).toBe(true);
  });

  it("does not for postures flown where you already are", () => {
    expect(missionNeedsTarget("CAP")).toBe(false);
    expect(missionNeedsTarget("BLOCKADE")).toBe(false);
    expect(missionNeedsTarget("CAS")).toBe(false);
  });
});
