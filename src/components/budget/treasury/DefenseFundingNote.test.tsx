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
    expect(screen.getByText(/running total falls/)).toBeTruthy();
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

  it("tells an overdrawn reader the balance grows and how to shrink it (issue #1753)", () => {
    render(<DefenseFundingNote sym="M" funding={overdrawn} />);
    expect(screen.getByText(/running total of past shortfalls/)).toBeTruthy();
    expect(screen.getByText(/grows each turn upkeep beats the line/)).toBeTruthy();
    expect(screen.getByText(/appropriate more or field less/)).toBeTruthy();
    expect(screen.getByText(/covered turns pay it back down/)).toBeTruthy();
  });

  it("surfaces the per-turn SOE backing next to the defence shortfall (issue #1754)", () => {
    render(<DefenseFundingNote sym="M" funding={overdrawn} soeNetPerTurn={-2_000_000_000} />);
    expect(screen.getByText("State enterprise backing per turn")).toBeTruthy();
    expect(screen.getByText("M2.0B")).toBeTruthy();
    // Footer totals both hidden draws: M491.1M + M2.0B = M2.5B. Footer figures
    // are bare text nodes, so assert on the paragraph content, not getByText.
    const check = screen.getByText(/Treasury check/);
    expect(check.textContent).toContain(
      "M491.1M beyond the defence line plus M2.0B state enterprise backing"
    );
    expect(check.textContent).toContain("M2.5B");
  });

  it("omits the enterprise tile when SOEs remit a profit", () => {
    render(<DefenseFundingNote sym="M" funding={overdrawn} soeNetPerTurn={5_000_000} />);
    expect(screen.queryByText("State enterprise backing per turn")).toBeNull();
    const check = screen.getByText(/Treasury check/);
    expect(check.textContent).toContain("beyond the defence line");
    expect(check.textContent).not.toContain("enterprise backing");
  });

  it("says so when there are no hidden draws", () => {
    render(<DefenseFundingNote sym="M" funding={funded} soeNetPerTurn={1_000_000} />);
    expect(screen.getByText(/no defence or enterprise draws/)).toBeTruthy();
  });

  it("flags an unknown enterprise figure instead of asserting zero", () => {
    render(<DefenseFundingNote sym="M" funding={overdrawn} soeNetPerTurn={null} />);
    expect(screen.queryByText("State enterprise backing per turn")).toBeNull();
    expect(screen.getByText(/not shown here/)).toBeTruthy();
  });
});
