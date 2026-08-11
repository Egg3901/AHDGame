import { describe, it, expect } from "vitest";
import { deriveMinisterFlags, deriveMinisterProjection, type MinisterInputs } from "./ministerLens";

const base: MinisterInputs = {
  sym: "$",
  revenueTotal: 100,
  spendingTotal: 100,
  gdp: 1000,
  debtPrincipal: 500,
  debtCeiling: 900,
  ceilingLabel: "Debt Ceiling",
  gdpGrowth: 2,
  inflationRate: 2,
};

describe("deriveMinisterFlags", () => {
  it("flags a balanced, low-debt budget as all-clear (no ceiling flag)", () => {
    const flags = deriveMinisterFlags(base);
    expect(flags).toHaveLength(2);
    expect(flags[0]).toMatchObject({ tone: "up", title: "Deficit within tolerance" });
    expect(flags[1]).toMatchObject({ tone: "up", title: "Debt-to-GDP contained" });
  });

  it("flags a deficit beyond 5% of GDP as down", () => {
    // spending 100 over revenue on gdp 1000 ⇒ −10% of GDP.
    const flags = deriveMinisterFlags({ ...base, spendingTotal: 200 });
    expect(flags[0]).toMatchObject({ tone: "down", title: "Deficit breaches 5% of GDP" });
  });

  it("flags a deficit between 3% and 5% as warning", () => {
    const flags = deriveMinisterFlags({ ...base, spendingTotal: 140 }); // −4% of GDP
    expect(flags[0]).toMatchObject({ tone: "warning", title: "Deficit above 3% of GDP" });
  });

  it("flags debt-to-GDP above 120% and near 100%", () => {
    expect(
      deriveMinisterFlags({ ...base, debtPrincipal: 1300, debtCeiling: 2000 })[1]
    ).toMatchObject({ tone: "down", title: "Debt-to-GDP above 120%" });
    expect(
      deriveMinisterFlags({ ...base, debtPrincipal: 950, debtCeiling: 2000 })[1]
    ).toMatchObject({ tone: "warning", title: "Debt-to-GDP near 100%" });
  });

  it("adds a ceiling flag when headroom is under ~2.5 years of deficit", () => {
    // deficit 100/yr, headroom 900−700 = 200 ⇒ 2.0 years < 2.5.
    const flags = deriveMinisterFlags({ ...base, spendingTotal: 200, debtPrincipal: 700 });
    expect(flags.some((f) => f.title.includes("Debt Ceiling") && f.tone === "down")).toBe(true);
  });

  it("uses the per-country ceiling label", () => {
    const flags = deriveMinisterFlags({
      ...base,
      spendingTotal: 200,
      debtPrincipal: 700,
      ceilingLabel: "Borrowing Limit",
    });
    expect(flags.some((f) => f.title.startsWith("Borrowing Limit"))).toBe(true);
  });
});

describe("deriveMinisterProjection", () => {
  it("projects revenue by GDP growth and spending by inflation + drift", () => {
    const p = deriveMinisterProjection(base);
    expect(p.projRevenue).toBeCloseTo(102, 5); // 100 * 1.02
    expect(p.projSpending).toBeCloseTo(103.4, 5); // 100 * (1 + 3.4/100)
    expect(p.projSurplus).toBeCloseTo(-1.4, 5);
  });

  it("raises the debt ratio when a large deficit outpaces growth", () => {
    // big deficit, no growth ⇒ debt climbs while GDP is flat.
    const p = deriveMinisterProjection({
      ...base,
      spendingTotal: 300,
      gdpGrowth: 0,
      inflationRate: 0,
    });
    expect(p.projSurplus).toBeLessThan(0);
    expect(p.projDebtToGdp).toBeGreaterThan(p.currentDebtToGdp);
  });

  it("lets the debt ratio fall when growth outpaces a small deficit", () => {
    // base: 2% growth, tiny 1.4 deficit ⇒ ratio eases despite debt creeping up.
    const p = deriveMinisterProjection(base);
    expect(p.projDebtToGdp).toBeLessThan(p.currentDebtToGdp);
  });
});
