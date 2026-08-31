import { describe, it, expect } from "vitest";
import {
  supplyScale,
  isResting,
  isWithdrawing,
  repairRate,
  freeRepairCeiling,
  repairedIntegrity,
  FREE_REPAIR_CEILING,
} from "../repair";
import * as R from "../config";
import { WITHDRAW_INTEGRITY } from "../missions";
import type { NavairUnit } from "../types";

/**
 * Repair, the third leg of the stool.
 *
 * A fight damages personnel, readiness and integrity. Reinforcement refills the first and
 * READINESS_REGEN the second; nothing has ever refilled the third, so a hull crippled once
 * was combat-ineffective for the rest of the game. The constants these functions read have
 * been sitting calibrated and unread in config.ts since the subsystem was written.
 */

const hull = (over: Partial<NavairUnit> = {}): NavairUnit =>
  ({
    _id: "u1",
    countryId: "UK",
    domain: "naval",
    type: "Guided-Missile Destroyer",
    name: "1st Test Squadron",
    mission: "SEA_CONTROL",
    station: "nat",
    integrity: 50,
    supply: 100,
    readiness: 70,
    ...over,
  }) as unknown as NavairUnit;

describe("supplyScale", () => {
  it("is zero at and below the minimum a yard needs", () => {
    expect(supplyScale(R.REPAIR.minSupply)).toBe(0);
    expect(supplyScale(0)).toBe(0);
  });

  it("is one at full supply", () => {
    expect(supplyScale(100)).toBe(1);
  });

  // Deliberately a ramp, not a threshold. The config records that a hard gate at 60 left
  // the Arctic station one point short and every game plateaued with both navies wrecked.
  it("ramps linearly between the two", () => {
    const mid = R.REPAIR.minSupply + (100 - R.REPAIR.minSupply) / 2;
    expect(supplyScale(mid)).toBeCloseTo(0.5, 5);
  });

  it("treats missing supply as full, matching supplyMult", () => {
    expect(supplyScale(undefined)).toBe(1);
  });
});

describe("isResting", () => {
  it("is true for a hull in port", () => {
    expect(isResting(hull({ mission: "PORT" }))).toBe(true);
  });

  it("is true for a wing stood down", () => {
    expect(isResting(hull({ domain: "air", mission: "STANDDOWN" }))).toBe(true);
  });

  it("is false for a hull on any active posture", () => {
    expect(isResting(hull({ mission: "BLOCKADE" }))).toBe(false);
    expect(isResting(hull({ mission: "SEA_CONTROL" }))).toBe(false);
  });

  // A formation nobody has ordered is not resting. It is unordered, and the standing
  // mission pass will give it a posture on this same tick.
  it("is false for a formation with no orders", () => {
    expect(isResting(hull({ mission: null }))).toBe(false);
  });
});

describe("repairRate", () => {
  it("is zero for a formation that fought this turn", () => {
    expect(repairRate(hull({ engaged: true, mission: "PORT" }), true)).toBe(0);
  });

  it("mends at the in-port rate when resting at full supply", () => {
    expect(repairRate(hull({ mission: "PORT" }), true)).toBe(R.REPAIR.inPort);
  });

  it("mends at the on-station rate otherwise", () => {
    expect(repairRate(hull(), false)).toBe(R.REPAIR.onStation);
  });

  it("scales the rate by supply", () => {
    const mid = R.REPAIR.minSupply + (100 - R.REPAIR.minSupply) / 2;
    expect(repairRate(hull({ supply: mid }), false)).toBeCloseTo(R.REPAIR.onStation / 2, 5);
  });

  it("mends nothing at or below the minimum supply a yard needs", () => {
    expect(repairRate(hull({ supply: R.REPAIR.minSupply }), true)).toBe(0);
  });
});

describe("freeRepairCeiling", () => {
  it("reaches full condition only in a home port", () => {
    expect(freeRepairCeiling("home", true)).toBe(FREE_REPAIR_CEILING.home);
    expect(FREE_REPAIR_CEILING.home).toBe(100);
  });

  it("stops short in an allied port", () => {
    expect(freeRepairCeiling("allied", true)).toBe(FREE_REPAIR_CEILING.allied);
  });

  // Basing rights are worth something, but not as much as your own yard.
  it("orders the ladder home, then allied, then station", () => {
    expect(FREE_REPAIR_CEILING.home).toBeGreaterThan(FREE_REPAIR_CEILING.allied);
    expect(FREE_REPAIR_CEILING.allied).toBeGreaterThan(FREE_REPAIR_CEILING.station);
  });

  // The ceiling is earned by RESTING somewhere, not merely by being there. A fleet
  // blockading out of its own home water is on station, not in a yard.
  it("gives the station ceiling to a formation that is not resting, even at home", () => {
    expect(freeRepairCeiling("home", false)).toBe(FREE_REPAIR_CEILING.station);
  });

  it("gives the station ceiling in neutral and hostile water", () => {
    expect(freeRepairCeiling("neutral", true)).toBe(FREE_REPAIR_CEILING.station);
    expect(freeRepairCeiling("hostile", true)).toBe(FREE_REPAIR_CEILING.station);
  });
});

describe("isWithdrawing", () => {
  // One doctrine, shared by the turn pass and the command page. When these two read the
  // rule differently the page told a commander 5% a turn toward 80% while the engine
  // delivered 12 toward 100, which is the "a forecast must never disagree with the
  // outcome" failure this codebase has been bitten by before.
  it("pulls back a badly damaged formation the engine stationed", () => {
    expect(isWithdrawing(hull({ integrity: 10 }))).toBe(true);
  });

  it("leaves a formation a commander stationed where it is", () => {
    expect(isWithdrawing(hull({ integrity: 10, stationSetByPlayer: true }))).toBe(false);
  });

  it("does not pull back a formation still fit to fight", () => {
    expect(isWithdrawing(hull({ integrity: 60 }))).toBe(false);
  });

  it("uses the same threshold the mission doctrine uses to save the ship", () => {
    expect(isWithdrawing(hull({ integrity: WITHDRAW_INTEGRITY - 0.1 }))).toBe(true);
    expect(isWithdrawing(hull({ integrity: WITHDRAW_INTEGRITY }))).toBe(false);
  });
});

describe("repairedIntegrity", () => {
  it("mends a damaged hull toward its ceiling", () => {
    const u = hull({ integrity: 50, mission: "PORT", station: "weu" });
    expect(repairedIntegrity(u, "home")).toBe(50 + R.REPAIR.inPort);
  });

  it("never pushes past the ceiling", () => {
    const u = hull({ integrity: 78, mission: "BLOCKADE" });
    expect(repairedIntegrity(u, "neutral")).toBe(FREE_REPAIR_CEILING.station);
  });

  // Moving a fresh hull onto station must not corrode it. Free repair only ever adds.
  it("leaves a formation already above its ceiling alone", () => {
    const u = hull({ integrity: 95, mission: "BLOCKADE" });
    expect(repairedIntegrity(u, "neutral")).toBe(95);
  });

  it("leaves a formation that fought this turn alone", () => {
    const u = hull({ integrity: 40, engaged: true, mission: "PORT" });
    expect(repairedIntegrity(u, "home")).toBe(40);
  });

  it("brings a wreck back off zero", () => {
    const u = hull({ integrity: 0, mission: "PORT", station: "weu" });
    expect(repairedIntegrity(u, "home")).toBeGreaterThan(0);
  });
});
