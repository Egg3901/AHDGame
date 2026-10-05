/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CabinetMonetaryStrip } from "./CabinetMonetaryStrip";

const MONETARY = {
  primeRate: 3,
  primeRateHistory: [],
  chairName: null,
  sovereignRate: 0.075,
  confidencePremium: 0,
  investorConfidence: 54,
  confidenceBaseline: 50,
  fxRate: null,
  fxBand: null,
  reserveBalance: null,
  forexRevenue: null,
  debtOp: {
    active: false,
    expiresTurn: null,
    cooldownUntilTurn: 0,
    boostPerTurn: null,
  },
};

describe("CabinetMonetaryStrip", () => {
  it("uses the integrated Cabinet tile treatment for monetary indicators", () => {
    const { container } = render(<CabinetMonetaryStrip m={MONETARY} />);

    expect(screen.getByText("Prime rate")).toBeTruthy();
    expect(screen.getByText("3.00%")).toBeTruthy();
    expect(screen.getByText("Sovereign rate")).toBeTruthy();
    expect(screen.getByText("7.50%")).toBeTruthy();
    expect(screen.getByText("54 / 50")).toBeTruthy();
    expect(screen.getByText("no intervention")).toBeTruthy();
    expect(container.firstElementChild?.className).toContain("divide-x");
    expect(container.querySelector(".rounded-lg")).toBeNull();
  });

  it("explains unavailable confidence rather than leaving an unexplained dash", () => {
    render(<CabinetMonetaryStrip m={{ ...MONETARY, investorConfidence: null }} />);

    expect(screen.getByText("not reported")).toBeTruthy();
  });

  it("shows the duration of an active debt operation", () => {
    render(
      <CabinetMonetaryStrip
        m={{ ...MONETARY, debtOp: { ...MONETARY.debtOp, active: true, expiresTurn: 18 } }}
      />
    );

    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("through turn 18")).toBeTruthy();
  });
});
