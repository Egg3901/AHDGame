/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MinisterCallouts } from "./MinisterCallouts";
import type { MinisterInputs } from "./ministerLens";

// Ticket #1272: the UK minister lens showed a 1B projected deficit and a
// 160%-to-181% debt-ratio jump with no visible reason. The card must state the
// assumptions driving it and name the denominator effect on the debt tile.
const contraction: MinisterInputs = {
  sym: "£",
  revenueTotal: 9_675_590_498.88,
  spendingTotal: 9_515_797_452.55,
  gdp: 20_750_000_000,
  debtPrincipal: 33_108_211_259,
  debtCeiling: 28_000_000_000,
  ceilingLabel: "Debt Ceiling",
  gdpGrowth: -9.334,
  inflationRate: 1.51,
};

describe("MinisterCallouts projection explanations", () => {
  it("states the growth and inflation assumptions behind the projection", () => {
    render(<MinisterCallouts inputs={contraction} subtitle="UK Finances" fiscalYear={1965} />);
    expect(screen.getByText(/Assumes -9\.3% real GDP growth, 1\.5% inflation/)).toBeTruthy();
  });

  it("names the denominator effect on the debt tile during a contraction", () => {
    render(<MinisterCallouts inputs={contraction} subtitle="UK Finances" fiscalYear={1965} />);
    expect(screen.getByText(/shrinking GDP lifts the ratio too/)).toBeTruthy();
  });

  it("keeps the plain debt sub when growth is positive", () => {
    render(
      <MinisterCallouts
        inputs={{ ...contraction, gdpGrowth: 2, inflationRate: 2 }}
        subtitle="UK Finances"
        fiscalYear={1965}
      />
    );
    expect(screen.queryByText(/shrinking GDP lifts the ratio too/)).toBeNull();
  });
});
