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
    expect((screen.getByText("Confirm Rate Change") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Next deadline: turn 132/)).toBeTruthy();
  });

  it("enables the control when governance allows", () => {
    render(<PrimeRateCard {...baseProps()} governance={allowedGovernance()} />);

    fireEvent.click(screen.getByText("+"));

    expect((screen.getByText("Confirm Rate Change") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/Next deadline: turn 116/)).toBeTruthy();
  });

  it("falls back to props when no governance is present", () => {
    render(<PrimeRateCard {...baseProps()} />);

    expect(screen.getByText("Adjust Rate")).toBeTruthy();
    fireEvent.click(screen.getByText("+"));
    expect((screen.getByText("Confirm Rate Change") as HTMLButtonElement).disabled).toBe(false);
  });

  it("hides the adjust section for an unauthorized viewer without governance", () => {
    render(<PrimeRateCard {...baseProps({ isChair: false })} />);

    expect(screen.queryByText("Adjust Rate")).toBeNull();
  });
});
