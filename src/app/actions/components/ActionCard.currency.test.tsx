// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import { makeCharacter } from "@/lib/test-utils/factories";
import { CARDS } from "../actionsConstants";
import type { ActionCardProps } from "../actionsTypes";
import ActionCard from "./ActionCard";
import ActionCardCompact from "./ActionCardCompact";

vi.mock("@/contexts/AuthDataContext", () => ({
  useAuthMe: () => ({
    user: { forexEnabled: true, character: { countryId: "DE", displayCurrencyPreference: "home" } },
  }),
}));
vi.mock("@/hooks/useWorldFlags", () => ({
  useWorldFlags: () => ({ preset: "1991-default", eurozoneEnabled: false }),
}));
vi.mock("@/hooks/useGameEvents", () => ({ useGameEvents: () => {} }));
vi.mock("next/image", () => ({ default: () => null }));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rates: { EUR: 0.85 }, baseRates: { EUR: 0.85 } }),
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function props(): ActionCardProps {
  const card = CARDS.find((c) => c.type === "convertCash");
  if (!card) throw new Error("Donation card is missing");
  return {
    card,
    character: makeCharacter({ countryId: "DE", actions: 20 }),
    imageUrl: "/donation.png",
    index: 0,
    viewMode: "cards",
    homeState: null,
    executing: null,
    flash: null,
    flipflopStep: null,
    flipflopAxis: null,
    flipflopDir: null,
    onExecute: vi.fn(),
    onFlipflop: vi.fn(),
    onFlipflopStepChange: vi.fn(),
    onFlipflopAxisChange: vi.fn(),
    onFlipflopDirChange: vi.fn(),
    campaignActionCost: 1,
    campaignFundCost: 0,
    campaignMaxed: false,
    advertiseActionCost: 1,
    advertiseFundCost: 0,
    fundraiseActionCost: 1,
    buildDonorBaseActionCost: 1,
    buildDonorBaseFundCost: 0,
    fundraiseYield: 0,
    campaignCurrency: "EUR",
    displayCampaignFunds: 0,
    displayPersonalWealth: 85,
    blockGdpScaledCosts: false,
    forexEnabled: true,
    convertCashOpen: true,
    // DM 97.7915 corresponds to exactly 50 stored EUR-equivalent units.
    convertCashAmount: "97.7915",
    onConvertCashOpenChange: vi.fn(),
    onConvertCashAmountChange: vi.fn(),
    onConvertCashExecute: vi.fn(),
  };
}

describe.each([
  { label: "full", Card: ActionCard, confirm: "Confirm donation", execute: "Yes, donate" },
  { label: "compact", Card: ActionCardCompact, confirm: "Go", execute: /inf, sure\?/ },
])("$label donation currency", ({ Card, confirm, execute }) => {
  it("displays marks, bounds the actual local balance and submits local ledger units", async () => {
    const input = props();
    render(
      <CurrencyProvider>
        <Card {...input} />
      </CurrencyProvider>
    );
    const amount = screen.getByRole("spinbutton") as HTMLInputElement;
    // The 85-unit wallet is DM 166.24555, not 85 * 0.85 * 1.95583.
    await waitFor(() => expect(amount.max).toBe("166"));
    fireEvent.click(screen.getByRole("button", { name: confirm }));
    fireEvent.click(screen.getByRole("button", { name: execute }));
    expect(input.onConvertCashExecute).toHaveBeenCalledWith(50);
  });
});
