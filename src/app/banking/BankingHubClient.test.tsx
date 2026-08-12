/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BankingHubClient } from "./BankingHubClient";

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("@/components/CountryFlag", () => ({
  CountryFlag: ({ country }: { country: string }) => (
    <span data-testid={`country-flag-${country}`} />
  ),
}));

const payload = {
  privateBankingEnabled: true,
  isAdmin: false,
  characterId: "character-1",
  primaryCountryId: "US",
  primaryCurrency: "USD",
  centralBanks: [
    {
      currency: "USD",
      bankName: "Federal Reserve",
      countryId: "US",
      countryName: "United States",
      href: "/centralbank/usd",
      primeRate: 5.25,
      savingsApyPercent: 2.5,
      isPrimary: true,
    },
    {
      currency: "GBP",
      bankName: "Bank of England",
      countryId: "UK",
      countryName: "United Kingdom",
      href: "/centralbank/gbp",
      primeRate: 4.75,
      savingsApyPercent: 2.25,
      isPrimary: false,
    },
  ],
  privateBanks: [
    {
      corporationId: "bank-1",
      sequentialId: 17,
      name: "Continental Trust",
      countryId: "US",
      countryName: "United States",
      currency: "USD",
      operatorType: "player",
      charterType: "universal",
      depositRatePercent: 3.1,
      lendingRatePercent: 7.5,
      warningBand: "green",
      confidence: 0.91,
      totalDeposits: 2_400_000,
      href: "/corporation/17?tab=bank",
    },
  ],
  savings: [
    {
      currency: "USD",
      balance: 125_000,
      currentHolder: "bank-1",
      options: [
        { holder: "centralBank", label: "Federal Reserve", depositRatePercent: 2.5 },
        { holder: "bank-1", label: "Continental Trust", depositRatePercent: 3.1 },
      ],
    },
  ],
  ceoCorporations: [{ id: "corp-1", name: "Acme Industrial" }],
  lendingBanks: [],
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
});

describe("BankingHubClient", () => {
  it("uses tabs for the policy, commercial banking, and account hierarchy", async () => {
    render(<BankingHubClient />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Banking & Credit" })).toBeTruthy()
    );

    expect(screen.getByRole("tab", { name: /Central banks/ }).getAttribute("aria-selected")).toBe(
      "true"
    );
    expect(screen.getByRole("heading", { name: "Central banks" })).toBeTruthy();
    expect(screen.getAllByTestId("country-flag-US").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Private banks" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /Private banks/ }));
    expect(screen.getByRole("heading", { name: "Private banks" })).toBeTruthy();
    expect(screen.getByText("Continental Trust")).toBeTruthy();
    expect(screen.getByText("Player-run")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Your accounts" }));
    expect(screen.getByRole("heading", { name: "Your accounts" })).toBeTruthy();
    expect(screen.getByLabelText("Savings holder for USD")).toBeTruthy();

    const primaryLink = screen.getByRole("link", { name: /Open policy desk/ });
    expect(primaryLink.getAttribute("href")).toBe("/centralbank/usd");
  });

  it("keeps private banking surfaces hidden behind the feature flag", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ...payload, privateBankingEnabled: false }),
      })
    );

    render(<BankingHubClient />);
    await waitFor(() => expect(screen.getByText("Bank of England")).toBeTruthy());

    expect(screen.queryByRole("tab", { name: /Private banks/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Your accounts" })).toBeNull();
  });
});
