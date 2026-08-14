/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FiscalStatStrip } from "./FiscalStatStrip";

const base = {
  sym: "₽",
  revenue: 1_000_000,
  spending: 900_000,
  gdp: 50_000_000,
  debtToGdp: 0.4,
  rating: "AAA" as const,
  treasuryReserve: 100_000,
};

describe("FiscalStatStrip GDP tile", () => {
  it("labels the growth figure as a fiscal-year assumption, not a live rate", () => {
    render(<FiscalStatStrip {...base} gdpGrowth={2.276} />);
    // The live USSR case: the budget page carried +2.276% (a turn-39 rollover
    // snapshot) while the Economy page showed -0.436%. Unlabelled, the two read
    // as a contradiction.
    expect(screen.getByText(/\+2\.3% FY assumption/)).toBeTruthy();
    expect(screen.queryByText(/\+2\.3% growth$/)).toBeNull();
  });

  it("explains in the tooltip that it does not move between rollovers", () => {
    render(<FiscalStatStrip {...base} gdpGrowth={-5.443} />);
    const title = screen.getByText(/-5\.4% FY assumption/).getAttribute("title") ?? "";
    expect(title).toContain("fixed at the last rollover");
    expect(title).toContain("Economy page");
  });

  it("keeps the era-dollar note alongside the assumption label", () => {
    render(<FiscalStatStrip {...base} gdpGrowth={1.5} toUsd={(n) => n / 4} />);
    expect(screen.getByText(/\+1\.5% FY assumption · ≈ \$/)).toBeTruthy();
  });
});
