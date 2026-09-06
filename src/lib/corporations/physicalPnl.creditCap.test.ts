import { describe, expect, it } from "vitest";

import { assemblePhysicalPnl, clampOtherOpexCredit } from "@/lib/corporations/physicalPnl";

const bills = {
  inputsCost: 400,
  laborCost: 150,
  financialLegs: 10,
  upkeep: 45,
  complianceCost: 25,
  growthCost: 20,
};
const billsTotal = 650;

describe("clampOtherOpexCredit", () => {
  it("never touches a charge (positive residual)", () => {
    expect(clampOtherOpexCredit({ otherOpex: 1234, ...bills })).toBe(1234);
    expect(clampOtherOpexCredit({ otherOpex: 0, ...bills })).toBe(0);
  });

  it("never touches a credit smaller than the named bills", () => {
    expect(clampOtherOpexCredit({ otherOpex: -649.99, ...bills })).toBe(-649.99);
    expect(clampOtherOpexCredit({ otherOpex: -billsTotal, ...bills })).toBe(-billsTotal);
  });

  it("clamps a credit larger than the named bills to exactly the bills", () => {
    expect(clampOtherOpexCredit({ otherOpex: -650.01, ...bills })).toBe(-billsTotal);
    expect(clampOtherOpexCredit({ otherOpex: -1.74e12, ...bills })).toBe(-billsTotal);
  });

  it("ignores negative bill lines when sizing the floor", () => {
    const floor = clampOtherOpexCredit({
      otherOpex: -1e9,
      ...bills,
      inputsCost: -400,
      growthCost: -20,
    });
    expect(floor).toBe(-(150 + 10 + 45 + 25));
  });

  it("a credit with no bills at all clamps to zero", () => {
    expect(
      clampOtherOpexCredit({
        otherOpex: -500,
        inputsCost: 0,
        laborCost: 0,
        financialLegs: 0,
        upkeep: 0,
        complianceCost: 0,
        growthCost: 0,
      })
    ).toBe(0);
  });

  it("nets a positive policy credit out of the bills before flooring", () => {
    expect(clampOtherOpexCredit({ otherOpex: -1e9, ...bills, policyCredit: 100 })).toBe(
      -(billsTotal - 100)
    );
    // A policy CHARGE (negative) does not widen the floor.
    expect(clampOtherOpexCredit({ otherOpex: -1e9, ...bills, policyCredit: -100 })).toBe(
      -billsTotal
    );
    // A policy credit larger than the bills leaves no room for any residual credit.
    expect(clampOtherOpexCredit({ otherOpex: -1, ...bills, policyCredit: 10_000 })).toBe(0);
  });

  it("passes non-finite input through untouched", () => {
    expect(clampOtherOpexCredit({ otherOpex: Number.NaN, ...bills })).toBeNaN();
  });
});

describe("assemblePhysicalPnl residual credit cap", () => {
  const base = { hourlyRevenue: 1000, ...bills, policyCredit: 0 };

  it("keeps the calibration identity where the credit is honest", () => {
    const pnl = assemblePhysicalPnl({ ...base, otherOpex: -100 });
    expect(pnl.otherOpex).toBe(-100);
    expect(pnl.otherOpexUncapped).toBe(-100);
    expect(pnl.otherOpexCreditCapped).toBe(false);
    expect(pnl.totalCost).toBe(billsTotal - 100);
    expect(pnl.profit).toBe(1000 - (billsTotal - 100));
  });

  it("profit can never exceed revenue through the residual (prod corp 643 shape)", () => {
    // Kanto rare-earth sector, turn 571: revenue 287M/day, named bills ~207M/day,
    // otherOpex -1.74T/day from anchor -1201 x 161K units. Scaled to hourly.
    const pnl = assemblePhysicalPnl({
      hourlyRevenue: 11_948_309,
      inputsCost: 5_554_394,
      laborCost: 2_095_315,
      financialLegs: 0,
      upkeep: 636_860,
      complianceCost: 367_478,
      growthCost: 0,
      otherOpex: -72_671_219_257,
      policyCredit: -84_836,
    });
    expect(pnl.otherOpexCreditCapped).toBe(true);
    expect(pnl.otherOpexUncapped).toBe(-72_671_219_257);
    expect(pnl.otherOpex).toBe(-(5_554_394 + 2_095_315 + 636_860 + 367_478));
    expect(pnl.totalCost).toBeCloseTo(84_836, 6);
    expect(pnl.profit).toBeLessThanOrEqual(11_948_309);
    expect(pnl.profit).toBeCloseTo(11_948_309 - 84_836, 6);
    expect(pnl.derivedMarginPct).toBe(100);
  });

  it("policy credit on top of an honest residual credit cannot push profit above revenue (prod retail shape)", () => {
    // FR_IDF retail, turn 571: residual credit inside the bills, but a 19.6pp
    // policy credit on top took total cost to -3.4M/day and profit 0.7% above revenue.
    const pnl = assemblePhysicalPnl({
      hourlyRevenue: 20_519_654,
      inputsCost: 13_076_272,
      laborCost: 7_085_795,
      financialLegs: 0,
      upkeep: 0,
      complianceCost: 0,
      growthCost: 0,
      otherOpex: -17_323_754,
      policyCredit: 4_021_852,
    });
    expect(pnl.otherOpexCreditCapped).toBe(true);
    expect(pnl.totalCost).toBeCloseTo(0, 6);
    expect(pnl.profit).toBeCloseTo(20_519_654, 6);
  });

  it("a positive residual is charged in full", () => {
    const pnl = assemblePhysicalPnl({ ...base, otherOpex: 300 });
    expect(pnl.otherOpex).toBe(300);
    expect(pnl.otherOpexCreditCapped).toBe(false);
    expect(pnl.totalCost).toBe(billsTotal + 300);
  });
});

describe("assemblePhysicalPnl policy-credit cap and net margin", () => {
  const base = {
    hourlyRevenue: 100,
    inputsCost: 5,
    laborCost: 3,
    upkeep: 1,
    complianceCost: 1,
    otherOpex: 0,
    financialLegs: 0,
    growthCost: 0,
  };

  it("caps policy credit at the bills it offsets so profit never exceeds revenue", () => {
    const pnl = assemblePhysicalPnl({ ...base, policyCredit: 60 });
    expect(pnl.policyCredit).toBe(10);
    expect(pnl.totalCost).toBe(0);
    expect(pnl.profit).toBe(100);
  });

  it("leaves a credit smaller than the bills alone", () => {
    const pnl = assemblePhysicalPnl({ ...base, policyCredit: 4 });
    expect(pnl.policyCredit).toBe(4);
    expect(pnl.profit).toBe(94);
  });

  it("does not touch a net policy penalty", () => {
    const pnl = assemblePhysicalPnl({ ...base, policyCredit: -7 });
    expect(pnl.policyCredit).toBe(-7);
    expect(pnl.profit).toBe(83);
  });

  it("reports a net margin over every cost line, which goes negative when upkeep exceeds revenue", () => {
    const pnl = assemblePhysicalPnl({
      hourlyRevenue: 100,
      inputsCost: 40,
      laborCost: 20,
      upkeep: 90,
      complianceCost: 0,
      otherOpex: 0,
      financialLegs: 0,
      growthCost: 0,
      policyCredit: 0,
    });
    expect(pnl.derivedMarginPct).toBe(40);
    expect(pnl.netMarginPct).toBe(-50);
  });
});
