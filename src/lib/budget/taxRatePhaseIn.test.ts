import { describe, expect, it } from "vitest";
import {
  TAX_RATE_PHASE_IN_MAX_STEP_PP,
  advanceTaxRatePhaseIn,
  needsPhaseIn,
  phaseInTurns,
  stepTaxRate,
} from "./taxRatePhaseIn";

describe("stepTaxRate", () => {
  it("applies a small change whole, so routine budget tweaks are unaffected", () => {
    expect(stepTaxRate(20, 20.5)).toBe(20.5);
    expect(stepTaxRate(20, 19.5)).toBe(19.5);
    expect(needsPhaseIn(20, 20.5)).toBe(false);
  });

  it("moves at most one step on a large rise", () => {
    // The ticket 1102 shape: 0 to 5 in one turn is what caused the recession.
    expect(stepTaxRate(0, 5)).toBe(TAX_RATE_PHASE_IN_MAX_STEP_PP);
    expect(needsPhaseIn(0, 5)).toBe(true);
  });

  it("moves at most one step on a large cut", () => {
    expect(stepTaxRate(10, 0)).toBe(10 - TAX_RATE_PHASE_IN_MAX_STEP_PP);
  });

  it("lands exactly on the target and never overshoots", () => {
    let rate = 0;
    for (let i = 0; i < 20 && rate !== 5; i++) rate = stepTaxRate(rate, 5);
    expect(rate).toBe(5);
  });

  it("treats an absent current rate as zero rather than NaN", () => {
    expect(stepTaxRate(undefined, 3)).toBe(TAX_RATE_PHASE_IN_MAX_STEP_PP);
    expect(stepTaxRate(null, 0.5)).toBe(0.5);
  });

  it("reports how long a move takes", () => {
    expect(phaseInTurns(0, 5)).toBe(5);
    expect(phaseInTurns(5, 5)).toBe(0);
  });
});

describe("advanceTaxRatePhaseIn", () => {
  it("steps a pending target and keeps it pending until reached", () => {
    const out = advanceTaxRatePhaseIn({ salesTax: 0 }, { salesTax: 5 });
    expect(out.rates.salesTax).toBe(1);
    expect(out.pending.salesTax).toBe(5);
    expect(out.changed).toBe(true);
  });

  it("drops the entry on the turn the target is reached", () => {
    const out = advanceTaxRatePhaseIn({ salesTax: 4.5 }, { salesTax: 5 });
    expect(out.rates.salesTax).toBe(5);
    expect(out.pending).toEqual({});
  });

  it("does nothing when there is no pending ramp", () => {
    const out = advanceTaxRatePhaseIn({ salesTax: 5 }, undefined);
    expect(out.rates).toEqual({});
    expect(out.pending).toEqual({});
    expect(out.changed).toBe(false);
  });

  it("advances several taxes independently", () => {
    const out = advanceTaxRatePhaseIn({ salesTax: 0, tariffs: 1.5 }, { salesTax: 5, tariffs: 2 });
    expect(out.rates.salesTax).toBe(1);
    expect(out.rates.tariffs).toBe(2);
    expect(out.pending).toEqual({ salesTax: 5 });
  });

  it("ignores a malformed target instead of writing NaN into a live rate", () => {
    const out = advanceTaxRatePhaseIn({ salesTax: 3 }, {
      salesTax: Number.NaN,
    } as unknown as Record<string, number>);
    expect(out.rates).toEqual({});
    expect(out.changed).toBe(false);
  });

  it("does not accumulate float drift across a fractional ramp", () => {
    let rate = 0;
    for (let i = 0; i < 40 && rate !== 3.7; i++) {
      rate = advanceTaxRatePhaseIn({ t: rate }, { t: 3.7 }).rates.t ?? rate;
    }
    expect(rate).toBe(3.7);
  });
});
