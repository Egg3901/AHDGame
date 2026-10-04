/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BankTreasuryPanel } from "./BankTreasuryPanel";
import type { BankTreasuryOverview } from "@/lib/banking/bankTreasury";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

const overview: BankTreasuryOverview = {
  currency: "USD",
  cashReserves: 10_000,
  cashFloor: {
    floorLocal: 0,
    requiredReserves: 0,
    withdrawalBufferLocal: 0,
    nextTurnDueInterest: 0,
  },
  spendableCash: 10_000,
  markValueLocal: 0,
  autoSweep: false,
  fundingRatePercent: 0,
  positions: [],
};
const offer = {
  bondId: "660000000000000000000002",
  issuer: "United States",
  countryId: "US",
  currency: "USD" as const,
  units: 0,
  maturityTurn: 340,
  remainingTurns: 240,
  couponRate: 4,
  bidPerUnitLocal: 990,
  askPerUnitLocal: 1_020,
  executablePoolDepthUnits: 0,
  markedValueLocal: 0,
  eligibleToBuy: false,
  unsoldUnits: 10,
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sovereign primary subscription consent", () => {
  it("renders no primary control or extra fetch without enabled offers", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(
      <BankTreasuryPanel
        corporationId="bank"
        overview={overview}
        canMutate
        onChanged={vi.fn()}
        showToast={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: "Subscribe" })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reviews and submits the displayed native maximum price before buying", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "completed", units: 2, amountLocal: 2_040 }), {
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetch);
    const confirm = vi.fn().mockReturnValue(true);
    Object.defineProperty(window, "confirm", { configurable: true, value: confirm });
    const changed = vi.fn().mockResolvedValue(undefined);
    render(
      <BankTreasuryPanel
        corporationId="bank"
        overview={{ ...overview, primaryOffers: [offer] }}
        canMutate
        onChanged={changed}
        showToast={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText("Bill units per trade"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(confirm.mock.lastCall?.[0]).toContain("240 turns");
    expect(JSON.parse(fetch.mock.lastCall![1].body)).toMatchObject({
      action: "subscribePrimary",
      bondId: offer.bondId,
      units: 2,
      maxCostLocal: 2_040,
    });
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  });
  it("does not submit a declined review or out-of-range units", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const confirm = vi.fn().mockReturnValue(false);
    Object.defineProperty(window, "confirm", { configurable: true, value: confirm });
    render(
      <BankTreasuryPanel
        corporationId="bank"
        overview={{ ...overview, primaryOffers: [offer] }}
        canMutate
        onChanged={vi.fn()}
        showToast={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Bill units per trade"), { target: { value: "11" } });
    fireEvent.click(screen.getByRole("button", { name: "Subscribe" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
