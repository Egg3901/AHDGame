/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { FactorBreakdown } from "./FactorBreakdown";

const FACTORS = {
  base: 2,
  headroom: 0.3,
  ownDiminishing: 1,
  psLeverage: 1.25,
  catchup: 1.5,
};

describe("FactorBreakdown", () => {
  it("shows open pool as a percent with an unaffiliated hint", () => {
    render(<FactorBreakdown factors={FACTORS} />);
    expect(screen.getByText("Open pool")).toBeTruthy();
    expect(screen.getByText("30%")).toBeTruthy();
    expect(screen.getByText(/Unaffiliated share/i)).toBeTruthy();
  });

  it("shows growth pace with no-slowdown hint when below the diminishing threshold", () => {
    render(<FactorBreakdown factors={FACTORS} />);
    expect(screen.getByText("Growth pace")).toBeTruthy();
    expect(screen.getByText("1.00×")).toBeTruthy();
    expect(screen.getByText(/No slowdown/i)).toBeTruthy();
  });

  it("shows above-50% hint when own diminishing is active", () => {
    render(<FactorBreakdown factors={{ ...FACTORS, ownDiminishing: 0.5 }} />);
    expect(screen.getByText("0.50×")).toBeTruthy();
    expect(screen.getByText(/Slower growth above 50%/i)).toBeTruthy();
  });

  it("shows pool full when headroom is zero", () => {
    render(<FactorBreakdown factors={{ ...FACTORS, headroom: 0 }} />);
    expect(screen.getByText("0%")).toBeTruthy();
    expect(screen.getByText(/Pool full/i)).toBeTruthy();
  });
});
