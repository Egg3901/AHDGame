/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SovereignProjection } from "@/lib/publicFinance/queries/federalBudgetDetail";
import { SovereignHealthPanel } from "./SovereignHealthPanel";

const warningSovereign: SovereignProjection = {
  state: "normal",
  demandRatio: 1.983,
  failedAuctions: 0,
  marketAccess: "Open",
  marketAccessUntilTurn: null,
  ceilingUseRatio: 0.892,
  ceilingHeadroom: 12_955_142_605,
  ceilingHeadroomYears: 1.53,
  ceilingStatus: "warning",
};

describe("SovereignHealthPanel ceiling signal", () => {
  it("shows a public warning when effective borrowing headroom is short", () => {
    render(<SovereignHealthPanel sym="M" sovereign={warningSovereign} />);

    expect(screen.getByText("Debt ceiling warning")).toBeTruthy();
    expect(screen.getByText(/89% of the effective limit is used/)).toBeTruthy();
    expect(screen.getByText(/1.5 years/)).toBeTruthy();
  });
});
