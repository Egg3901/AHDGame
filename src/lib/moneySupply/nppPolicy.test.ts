import { describe, expect, it } from "vitest";
import { chooseNppMonetaryOperation } from "./nppPolicy";

describe("autonomous central-bank monetary operations", () => {
  const baseline = {
    inflation: 2,
    targetInflation: 2,
    gdpGrowth: 2,
    annualizedM2GrowthPct: 4,
    moneyGrowthReliable: true,
    publicFloat: 1_000,
    holdings: 100,
    bankReserves: 100,
    gdp: 10_000,
    treasuryBalance: -1_000,
  };

  it("uses QE in a weak, below-target economy", () => {
    expect(
      chooseNppMonetaryOperation({
        ...baseline,
        inflation: 0.5,
        gdpGrowth: 0,
      })
    ).toEqual(
      expect.objectContaining({
        type: "qe",
        units: 10,
        rationale: expect.stringMatching(/below target/i),
      })
    );
  });

  it("uses QT when inflation and broad-money growth are excessive", () => {
    expect(
      chooseNppMonetaryOperation({
        ...baseline,
        inflation: 5,
        gdpGrowth: 4,
        annualizedM2GrowthPct: 14,
        holdings: 80,
      })
    ).toEqual(
      expect.objectContaining({
        type: "qt",
        units: 8,
        rationale: expect.stringMatching(/inflation|money/i),
      })
    );
  });

  it("injects lending liquidity in a recession when reserves are thin and QE is unavailable", () => {
    expect(
      chooseNppMonetaryOperation({
        ...baseline,
        inflation: 1.5,
        gdpGrowth: -1,
        publicFloat: 0,
        bankReserves: 10,
      })
    ).toEqual(
      expect.objectContaining({
        type: "liquidity_injection",
        amount: 25,
        rationale: expect.stringMatching(/credit|liquidity/i),
      })
    );
  });

  it("uses a small direct Treasury advance only in a severe deflationary fiscal emergency", () => {
    expect(
      chooseNppMonetaryOperation({
        ...baseline,
        inflation: -2,
        gdpGrowth: -4,
        publicFloat: 0,
        bankReserves: 500,
        treasuryBalance: -8_000,
      })
    ).toEqual(
      expect.objectContaining({
        type: "treasury_advance",
        amount: 10,
        rationale: expect.stringMatching(/emergency/i),
      })
    );
  });

  it("holds when price, growth, money, and liquidity conditions are balanced", () => {
    expect(chooseNppMonetaryOperation(baseline)).toEqual(
      expect.objectContaining({ type: "hold", rationale: expect.stringMatching(/within/i) })
    );
  });

  it("does not tighten against provisional early-world M2 annualization", () => {
    expect(
      chooseNppMonetaryOperation({
        ...baseline,
        annualizedM2GrowthPct: 5_000,
        moneyGrowthReliable: false,
      })
    ).toEqual(
      expect.objectContaining({ type: "hold", rationale: expect.stringMatching(/within/i) })
    );
  });

  it("explains when tightening is warranted but impossible without bond holdings", () => {
    expect(
      chooseNppMonetaryOperation({
        ...baseline,
        inflation: 5,
        holdings: 0,
      })
    ).toEqual(
      expect.objectContaining({
        type: "hold",
        rationale: expect.stringMatching(/holdings|rate/i),
      })
    );
  });
});
