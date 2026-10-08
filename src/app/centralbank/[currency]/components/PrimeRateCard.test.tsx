/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PrimeRateCard, type RateGovernance } from "./PrimeRateCard";

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    primeRate: 4,
    isChair: true,
    chairControlsLocked: false,
    lastRateChangeTurn: null,
    currentTurn: 108,
    bankApiBasePath: "/api/country/us/central-bank",
    onChanged: vi.fn(),
    ...overrides,
  };
}

function refusedGovernance(reason: string): RateGovernance {
  return {
    allowedActions: [{ action: "set_rate", allowed: false, reason }],
    nextDeadline: { turn: 132, kind: "meeting_deadline" },
  };
}

function allowedGovernance(): RateGovernance {
  return {
    allowedActions: [{ action: "set_rate", allowed: true }],
    nextDeadline: { turn: 116, kind: "cadence" },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PrimeRateCard governance contract", () => {
  it("disables the control and shows the reason when governance refuses", () => {
    render(
      <PrimeRateCard
        {...baseProps()}
        governance={refusedGovernance("A seated committee decides: vote in the committee room.")}
      />
    );

    expect(
      screen.getByText("A seated committee decides: vote in the committee room.")
    ).toBeTruthy();
    expect((screen.getByText("+") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Confirm rate change") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Next deadline: turn 132/)).toBeTruthy();
  });

  it("enables the control when governance allows", () => {
    render(<PrimeRateCard {...baseProps()} governance={allowedGovernance()} />);

    fireEvent.click(screen.getByText("+"));

    expect((screen.getByText("Confirm rate change") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/Next deadline: turn 116/)).toBeTruthy();
  });

  it("falls back to props when no governance is present", () => {
    render(<PrimeRateCard {...baseProps()} />);

    expect(screen.getByText("Adjust rate")).toBeTruthy();
    fireEvent.click(screen.getByText("+"));
    expect((screen.getByText("Confirm rate change") as HTMLButtonElement).disabled).toBe(false);
  });

  it("hides the adjust section for an unauthorized viewer without governance", () => {
    render(<PrimeRateCard {...baseProps({ isChair: false })} />);

    expect(screen.queryByText("Adjust rate")).toBeNull();
  });
});

describe("PrimeRateCard hike range", () => {
  it("shows the ordinary range and no catch-up note near target", () => {
    render(
      <PrimeRateCard
        {...baseProps()}
        governance={allowedGovernance()}
        inflationRate={3}
        targetInflation={2}
      />
    );
    expect(screen.getByText(/Hike max \+0\.75%/)).toBeTruthy();
    expect(screen.queryByText(/instead of 0\.75/)).toBeNull();
    expect(screen.queryByText("Hike by")).toBeNull();
  });

  it("explains the widened cap and offers steps up to it when inflation is far over target", () => {
    render(
      <PrimeRateCard
        {...baseProps()}
        governance={allowedGovernance()}
        inflationRate={16}
        targetInflation={2}
      />
    );
    expect(screen.getByText(/Hike max \+3\.00%/)).toBeTruthy();
    expect(screen.getByText(/Inflation is 16\.0% against a 2\.0% target/)).toBeTruthy();
    expect(screen.getByText(/Allowed range this change: 2\.25% to 7\.00%/)).toBeTruthy();

    fireEvent.click(screen.getByText("+3.00"));
    expect(screen.getAllByText("7.00%").length).toBeGreaterThan(0);
    expect((screen.getByText("Confirm rate change") as HTMLButtonElement).disabled).toBe(false);
  });
});
