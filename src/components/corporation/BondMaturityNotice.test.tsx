// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import BondMaturityNotice from "./BondMaturityNotice";
import type { BondInfo } from "./CorporationPageTypes";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (value: number) => `money:${value}`,
    toInternalFrom: (value: number) => value,
  }),
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function bondInfo(
  over: Partial<BondInfo> & { maturityTurn?: number; principal?: number; currentTurn?: number } = {}
): BondInfo {
  const { maturityTurn = 871, principal = 23_100_000, currentTurn = 777, ...rest } = over;
  return {
    bonds: [
      {
        _id: "b1",
        faceValue: principal,
        couponRate: 0.05,
        maturityTurns: 100,
        issuedAtTurn: 771,
        maturityTurn,
        marketPrice: principal,
        totalIssued: principal,
        totalIssuedAnchor: principal,
        publicFloat: 0,
        defaulted: false,
        matured: false,
        turnsRemaining: Math.max(0, maturityTurn - currentTurn),
        holders: 1,
      },
    ],
    imfFacility: null,
    creditRating: {},
    totalDebt: principal,
    isCeo: true,
    cooldownTurnsRemaining: 0,
    currentTurn,
    ...rest,
  } as unknown as BondInfo;
}

const baseProps = {
  liquidCapital: 100_000_000,
  corporationName: "Bank of America",
  corporationId: "corp-1",
};

describe("BondMaturityNotice", () => {
  it("renders nothing for non-CEOs and when no bond is live", () => {
    const { container: nonCeo } = render(
      <BondMaturityNotice {...baseProps} bondInfo={bondInfo({ isCeo: false })} />
    );
    expect(nonCeo.innerHTML).toBe("");

    const { container: noBonds } = render(
      <BondMaturityNotice {...baseProps} bondInfo={bondInfo({ bonds: [] })} />
    );
    expect(noBonds.innerHTML).toBe("");
  });

  it("states no action is needed when the repayment is far off and affordable", async () => {
    render(<BondMaturityNotice {...baseProps} bondInfo={bondInfo()} />);
    await screen.findByText(/No action needed\./);
    // The explainer collapses behind a disclosure instead of pushing the page down.
    expect(screen.getByText("Why this matters")).toBeTruthy();
  });

  it("dismisses the informational notice and remembers it", async () => {
    render(<BondMaturityNotice {...baseProps} bondInfo={bondInfo()} />);
    const dismiss = await screen.findByRole("button", { name: "Dismiss bond repayment notice" });
    fireEvent.click(dismiss);
    expect(screen.queryByText(/Bond repayment of/)).toBeNull();
    expect(window.localStorage.getItem("ahd-bond-maturity-dismissed-v1:corp-1:871")).toBe("1");
  });

  it("shows a covered due soon notice as informational and dismissible", async () => {
    render(<BondMaturityNotice {...baseProps} bondInfo={bondInfo({ currentTurn: 860 })} />);
    await screen.findByText(/Due soon\./);
    expect(screen.getByText(/Covered by current liquid capital of money:100000000/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss bond repayment notice" })).toBeTruthy();
  });

  it("overrides an earlier dismissal for a shortfall inside the action window", async () => {
    window.localStorage.setItem("ahd-bond-maturity-dismissed-v1:corp-1:871", "1");
    render(
      <BondMaturityNotice
        {...baseProps}
        liquidCapital={1_000_000}
        bondInfo={bondInfo({ currentTurn: 860 })}
      />
    );
    await screen.findByText(/Action needed: current cash is short by money:22100000\./);
    expect(screen.queryByRole("button", { name: "Dismiss bond repayment notice" })).toBeNull();
  });

  it("shows a covered projection as informational and lets the CEO dismiss it", async () => {
    render(
      <BondMaturityNotice
        {...baseProps}
        liquidCapital={1_000_000}
        recentRetainedEarningsPerTurn={250_000}
        bondInfo={bondInfo()}
      />
    );

    await screen.findByText("On track: projected cash at turn 871 covers this.");
    expect(screen.getByText(/projected liquid capital at turn 871 is money:24500000/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss bond repayment notice" }));
    expect(screen.queryByText(/Bond repayment of/)).toBeNull();
    expect(window.localStorage.getItem("ahd-bond-maturity-dismissed-v1:corp-1:871")).toBe("1");
  });

  it("keeps a far off projected shortfall quiet and dismissible", async () => {
    render(
      <BondMaturityNotice
        {...baseProps}
        liquidCapital={1_000_000}
        recentRetainedEarningsPerTurn={100_000}
        bondInfo={bondInfo()}
      />
    );

    await screen.findByText(/Projected cash at turn 871 is short by money:12700000\./);
    expect(screen.getByRole("button", { name: "Dismiss bond repayment notice" })).toBeTruthy();
  });

  it("makes a projected shortfall persistent at 48 turns before maturity", async () => {
    render(
      <BondMaturityNotice
        {...baseProps}
        liquidCapital={1_000_000}
        recentRetainedEarningsPerTurn={100_000}
        bondInfo={bondInfo({ currentTurn: 823 })}
      />
    );

    await screen.findByText(
      /Action needed: projected cash at turn 871 is short by money:17300000\./
    );
    expect(screen.queryByRole("button", { name: "Dismiss bond repayment notice" })).toBeNull();
  });

  it("demands action when the repayment is due now", async () => {
    render(
      <BondMaturityNotice
        {...baseProps}
        liquidCapital={1_000_000}
        bondInfo={bondInfo({ currentTurn: 871 })}
      />
    );
    await screen.findByText(/Bond repayment due now: money:23100000/);
    await screen.findByText(/Action needed: current cash is short by money:22100000\./);
    expect(screen.queryByRole("button", { name: "Dismiss bond repayment notice" })).toBeNull();
  });
});
