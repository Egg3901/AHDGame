/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CabinetForceStrip } from "./CabinetForceStrip";

afterEach(cleanup);

const SUMMARY = {
  unitCount: 4,
  totalPower: 1200,
  totalPersonnel: 40_000,
  totalUpkeep: 600,
  avgReadiness: 75,
  forwardShare: 0.25,
  treasuryBalance: 1_000_000_000,
  gdp: 387_000_000_000,
  militaryPriceBaselineGdp: 387_000_000_000,
  appropriation: 11_610_000_000,
  appropriationAccrual: 241_875_000,
  appropriationUpkeep: 133_031_250,
  arrearsRatio: 0,
  hasBudget: true,
  tier: "standard",
};

describe("CabinetForceStrip", () => {
  // This strip carried two budget-shaped numbers that were not money: a synthetic
  // "Defense budget" envelope (floored at a country-independent constant, so 26 of 27 live
  // nations read the identical figure) and a force-upkeep INDEX rendered through a millions
  // formatter. Both are gone. Every money-shaped value here is now real money.
  it("shows only real money — no envelope, no synthetic budget", () => {
    render(<CabinetForceStrip forceSummary={SUMMARY} />);
    expect(screen.getByText("Appropriation")).toBeTruthy();
    expect(screen.queryByText("Upkeep allowance")).toBeNull();
    expect(screen.queryByText("Defense budget")).toBeNull();
    expect(screen.queryByText("metric threshold")).toBeNull();
  });

  // The old tile printed the abstract aggregate (600) as "$600M" beside an $11.6B pot. The
  // real charge is what the appropriation is actually debited each turn.
  it("reports force upkeep as the real per-turn charge, with its share of income", () => {
    render(<CabinetForceStrip forceSummary={SUMMARY} />);
    expect(screen.getByText("Force upkeep")).toBeTruthy();
    // 133,031,250 of 241,875,000 accrued = 55%.
    expect(screen.getByText(/55% of income/)).toBeTruthy();
  });

  it("warns when the force outruns the line rather than showing a bare figure", () => {
    render(<CabinetForceStrip forceSummary={{ ...SUMMARY, appropriationUpkeep: 400_000_000 }} />);
    expect(screen.getByText(/165% of income/)).toBeTruthy();
  });

  it("reports the net per turn, and flips to arrears when the account cannot pay", () => {
    render(<CabinetForceStrip forceSummary={SUMMARY} />);
    // 241,875,000 accrual − 133,031,250 upkeep = 108,843,750/turn. Matched on the FIGURE,
    // because the force-upkeep tile beside it ($133M/turn) also ends in "/turn".
    expect(screen.getByText("$109M/turn")).toBeTruthy();

    cleanup();
    render(<CabinetForceStrip forceSummary={{ ...SUMMARY, arrearsRatio: 0.3 }} />);
    expect(screen.getByText("in arrears 30%")).toBeTruthy();
    // The appropriation tile swaps its net for the arrears note; the net figure goes.
    expect(screen.queryByText("$109M/turn")).toBeNull();
  });

  it("shows available manpower beside active personnel", () => {
    render(<CabinetForceStrip forceSummary={SUMMARY} manpowerPool={1_250_000} />);
    expect(screen.getByText("Active personnel")).toBeTruthy();
    expect(screen.getByText("Available manpower")).toBeTruthy();
    expect(screen.getByText("1.3M")).toBeTruthy();
  });

  it("shows a dash when the pool is unknown", () => {
    render(<CabinetForceStrip forceSummary={SUMMARY} />);
    expect(screen.getByText("Available manpower")).toBeTruthy();
    // Scope to the tile rather than getByText("—") — a bare dash would also
    // match any other Tile that renders one.
    // closest("div") IS the Tile root (Tile.tsx:19) — do not walk to
    // parentElement, that is the whole grid and would match any tile.
    const tile = screen.getByText("Available manpower").closest("div");
    expect(tile?.textContent).toContain("—");
  });
});
