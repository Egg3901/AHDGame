import { describe, expect, it } from "vitest";
import {
  RAMP_TURNS,
  classMult,
  classifyDrift,
  compoundAnnual,
  criticalTol,
  lerp,
  rateCriticalPts,
  rateWarnPts,
  warnTol,
  withinRelTol,
  yearsFromCalendarTurn,
} from "./tolerance";

describe("lerp", () => {
  it("returns endpoints and midpoint", () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });
});

describe("warnTol / criticalTol curve", () => {
  const turns = [1, 48, 240, 480, 1000] as const;

  it("ramps gdp warn from 15% toward 40% by RAMP_TURNS and plateaus after", () => {
    const at1 = warnTol(1, "gdp");
    const at48 = warnTol(48, "gdp");
    const at240 = warnTol(240, "gdp");
    const at480 = warnTol(480, "gdp");
    const at1000 = warnTol(1000, "gdp");

    expect(warnTol(0, "gdp")).toBeCloseTo(0.15, 10);
    expect(at1).toBeCloseTo(lerp(0.15, 0.4, 1 / RAMP_TURNS), 10);
    expect(at48).toBeCloseTo(lerp(0.15, 0.4, 48 / RAMP_TURNS), 10);
    expect(at240).toBeCloseTo(lerp(0.15, 0.4, 240 / RAMP_TURNS), 10);
    expect(at480).toBeCloseTo(0.4, 10);
    expect(at1000).toBeCloseTo(0.4, 10);
    expect(at1).toBeLessThan(at48);
    expect(at48).toBeLessThan(at240);
    expect(at240).toBeLessThan(at480);
    expect(at1000).toBe(at480);
  });

  it("criticalTol is always 2× warnTol", () => {
    for (const t of turns) {
      expect(criticalTol(t, "gdp")).toBeCloseTo(2 * warnTol(t, "gdp"), 12);
      expect(criticalTol(t, "forex")).toBeCloseTo(2 * warnTol(t, "forex"), 12);
    }
  });

  it("applies class multipliers", () => {
    expect(classMult("population")).toBe(0.25);
    expect(classMult("gdp")).toBe(1.0);
    expect(classMult("debt")).toBe(1.25);
    expect(classMult("forex")).toBe(1.5);
    expect(classMult("commodity")).toBe(1.5);
    expect(classMult("sector")).toBe(1.25);

    const base = warnTol(0, "gdp");
    expect(warnTol(0, "population")).toBeCloseTo(base * 0.25, 12);
    expect(warnTol(0, "debt")).toBeCloseTo(base * 1.25, 12);
    expect(warnTol(0, "forex")).toBeCloseTo(base * 1.5, 12);
  });
});

describe("rate point bands", () => {
  it("starts at ±3 warn / ±6 critical and widens with the lerp scale", () => {
    expect(rateWarnPts(0)).toBeCloseTo(3, 10);
    expect(rateCriticalPts(0)).toBeCloseTo(6, 10);
    expect(rateWarnPts(RAMP_TURNS)).toBeCloseTo(3 * (0.4 / 0.15), 10);
    expect(rateCriticalPts(RAMP_TURNS)).toBeCloseTo(2 * rateWarnPts(RAMP_TURNS), 10);
  });
});

describe("classifyDrift magnitude guard", () => {
  it("flags >3× or <1/3 as critical regardless of turn", () => {
    const hi = classifyDrift({
      actual: 301,
      expected: 100,
      calendarTurn: 1,
      cls: "gdp",
    });
    expect(hi.severity).toBe("critical");
    expect(hi.note).toBe("magnitude break");

    const lo = classifyDrift({
      actual: 30,
      expected: 100,
      calendarTurn: 1000,
      cls: "forex",
    });
    expect(lo.severity).toBe("critical");
    expect(lo.note).toBe("magnitude break");
  });

  it("returns ok within warn band and warn between warn and critical", () => {
    const ok = classifyDrift({
      actual: 100,
      expected: 100,
      calendarTurn: 0,
      cls: "gdp",
    });
    expect(ok.severity).toBe("ok");

    // At t=0 gdp warn=0.15, critical=0.30 → 20% drift is warn
    const warn = classifyDrift({
      actual: 120,
      expected: 100,
      calendarTurn: 0,
      cls: "gdp",
    });
    expect(warn.severity).toBe("warn");

    const crit = classifyDrift({
      actual: 140,
      expected: 100,
      calendarTurn: 0,
      cls: "gdp",
    });
    expect(crit.severity).toBe("critical");
    expect(crit.note).toBeUndefined();
  });
});

describe("trajectory compounding", () => {
  it("compounds by annual percent over yearsFromCalendarTurn", () => {
    const years = yearsFromCalendarTurn(48);
    expect(years).toBe(1);
    expect(compoundAnnual(100, 2.5, 1)).toBeCloseTo(102.5, 10);
    expect(compoundAnnual(100, 5, 2)).toBeCloseTo(110.25, 10);
  });

  it("treats sub-1 rates as percent, not fractions (0.8 → 0.8%/yr)", () => {
    // Old abs>1 heuristic would have treated 0.8 as 80%/yr → ~1.8× in one year.
    expect(compoundAnnual(100, 0.8, 1)).toBeCloseTo(100.8, 10);
    const over48 = compoundAnnual(1000, 0.8, yearsFromCalendarTurn(48));
    expect(over48).toBeCloseTo(1000 * Math.pow(1.008, 1), 10);
    expect(over48).toBeLessThan(1010);
    expect(over48).not.toBeCloseTo(1000 * 1.8, 0);
  });

  it("leaves baseline unchanged for zero/negative years", () => {
    expect(compoundAnnual(100, 5, 0)).toBe(100);
    expect(compoundAnnual(100, 5, -1)).toBe(100);
  });
});

describe("withinRelTol", () => {
  it("accepts values within 1% by default", () => {
    expect(withinRelTol(100, 100)).toBe(true);
    expect(withinRelTol(100.5, 100)).toBe(true);
    expect(withinRelTol(102, 100)).toBe(false);
  });
});
