import { describe, expect, it } from "vitest";
import { computeSectorLaborCost } from "@/lib/labour/laborCost";
import {
  getHomeLocationMarginBonus,
  getStateSectorSpecializationMarginBonus,
  softCapEffectiveMargin,
} from "@/lib/constants/corporations";
import {
  getSectorTypeMatchModifier,
  specializationMaintenance,
  specializationPayrollModifier,
} from "./rules";

describe("productive corporate specialization", () => {
  it.each([
    ["energy", 5, 5],
    ["retail", 2.5, 2.5],
    ["media", -15, -15],
  ])("prices %s specialization while preserving its payroll basis", (type, bonus, payroll) => {
    expect(getSectorTypeMatchModifier(type, "energy", "retail")).toBe(bonus);
    expect(specializationPayrollModifier(type, "energy", "retail")).toBe(payroll);
  });

  it("does not turn an operating bonus into a wage cut at the payroll clamp", () => {
    const oldMargin = softCapEffectiveMargin(85);
    const newMargin = softCapEffectiveMargin(90);
    const { payrollBasis, operatingSaving } = specializationMaintenance({
      revenue: 1000,
      payrollMargin: oldMargin,
      operatingMargin: newMargin,
    });
    const before = computeSectorLaborCost({
      hourlyRevenue: 1000,
      grossMaintenance: 1000 * (1 - oldMargin / 100),
      laborShare0: 0.5,
      wageMultiplier: 1.2,
    });
    const after = computeSectorLaborCost({
      hourlyRevenue: 1000,
      grossMaintenance: payrollBasis,
      laborShare0: 0.5,
      wageMultiplier: 1.2,
    });
    expect(after.laborCost).toBe(before.laborCost);
    expect(after.maintenance - operatingSaving).toBeLessThan(before.maintenance);
    expect(operatingSaving).toBeLessThan(50);
  });

  it("no longer stacks a universal +10 for operating your own type at home", () => {
    // Own type (+5), home state (+5) and a primary state specialization (+5)
    // used to be +30 on a 35% base. They now total +15.
    const stack =
      getSectorTypeMatchModifier("energy", "energy") +
      getHomeLocationMarginBonus("TX", "TX", "US", "US") +
      getStateSectorSpecializationMarginBonus({ primary: "energy", secondary: "retail" }, "energy");
    expect(stack).toBe(15);
    expect(getHomeLocationMarginBonus("CA", "TX", "US", "US")).toBe(2.5);
    expect(getHomeLocationMarginBonus("ON", "TX", "CA", "US")).toBe(0);
    expect(
      getStateSectorSpecializationMarginBonus({ primary: "energy", secondary: "retail" }, "retail")
    ).toBe(2.5);
    // Matching your own type at home is still worth more than a mismatch.
    expect(getSectorTypeMatchModifier("media", "energy")).toBe(-15);
  });

  it("does not create operating savings without sales", () => {
    expect(
      specializationMaintenance({ revenue: 0, operatingMargin: 45, payrollMargin: 40 })
    ).toEqual({ payrollBasis: 0, operatingSaving: 0 });
  });
});
