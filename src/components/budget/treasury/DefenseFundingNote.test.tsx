/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DefenseFundingNote } from "./DefenseFundingNote";
import type { DefenseFundingPosition } from "@/lib/publicFinance/queries/defenseFunding";

const funded: DefenseFundingPosition = {
  lineAnnual: 48_000_000,
  accrualPerTurn: 1_000_000,
  upkeepPerTurn: 550_000,
  shortfallPerTurn: 0,
  potBalance: 2_000_000,
  arrearsRatio: 0,
  unitCount: 10,
};

const overdrawn: DefenseFundingPosition = {
  lineAnnual: 34_570_712_273,
  accrualPerTurn: 720_223_172,
  upkeepPerTurn: 1_211_274_865,
  shortfallPerTurn: 491_051_693,
  potBalance: -6_464_629_934,
  arrearsRatio: 0,
  unitCount: 22,
};

describe("DefenseFundingNote (ticket #1269)", () => {
  it("shows upkeep covered by the line with no shortfall", () => {
    render(<DefenseFundingNote sym="M" funding={funded} />);
    expect(screen.getByText("Defence funding")).toBeTruthy();
    expect(screen.getByText(/no overdraft drawn/)).toBeTruthy();
  });

  it("names the beyond-the-line draw that the surplus tile misses", () => {
    render(<DefenseFundingNote sym="M" funding={overdrawn} />);
    // Per-turn bleed, compact billions.
    expect(screen.getByText("M491.1M")).toBeTruthy();
    // Cumulative position.
    expect(screen.getByText("-M6.5B")).toBeTruthy();
    expect(screen.getByText(/Overdrawn/)).toBeTruthy();
    // The reconciliation sentence: why the treasury can fall under a surplus.
    expect(screen.getByText(/never appears in spending/)).toBeTruthy();
  });
});
