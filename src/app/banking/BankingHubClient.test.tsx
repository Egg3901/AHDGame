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
      cashReserves: 1_200_000,
      lendableHeadroom: 900_000,
      href: "/corporation/17?tab=bank",
    },
    {
      corporationId: "bank-2",
      sequentialId: 23,
      name: "Meridian Mutual",
      countryId: "UK",
      countryName: "United Kingdom",
      currency: "GBP",
      operatorType: "npp",
      charterType: "retail",
      depositRatePercent: 4.0,
      lendingRatePercent: 6.0,
      warningBand: "amber",
      confidence: 0.55,
      totalDeposits: 800_000,
      cashReserves: 200_000,
      lendableHeadroom: 300_000,
      href: "/corporation/23?tab=bank",
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
  savingsBalances: { USD: 125_000 },
  personalCash: { USD: 40_000 },
  displayFxRates: { USD: 1 },
  personalIncomeByCurrency: { USD: 50_000 },
  currentTurn: 115,
  ceoCorporations: [
    {
      id: "corp-1",
      name: "Acme Industrial",
      liquidCapital: 2_000_000,
      incomePerTurn: 80_000,
      currency: "USD",
    },
  ],
  loans: [
    {
      id: "loan-1",
      bankCorporationId: "bank-1",
      bankName: "Continental Trust",
      bankSequentialId: 17,
      currency: "USD",
      borrowerType: "corporation",
      borrowerId: "corp-1",
      borrowerName: "Acme Industrial",
      creditedTo: "corporationLiquidCapital",
      principal: 1_000_000,
      outstanding: 988_000,
      ratePercent: 7.5,
      originatedTurn: 110,
      termTurns: 12,
      status: "current",
    },
  ],
  lendingBanks: [
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
      cashReserves: 1_200_000,
      lendableHeadroom: 900_000,
      href: "/corporation/17?tab=bank",
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
});

describe("BankingHubClient", () => {
  it("puts private-bank customer actions in the first screen shortcuts", async () => {
    render(<BankingHubClient />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Browse private banks" })).toBeTruthy()
    );

    fireEvent.click(screen.getByRole("button", { name: "Browse private banks" }));
    expect(screen.getByRole("heading", { name: "Private banks" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Deposit or borrow" }));
    expect(screen.getByRole("heading", { name: "Your accounts" })).toBeTruthy();
  });

  it("uses tabs for the commercial banking, policy, and account hierarchy", async () => {
    render(<BankingHubClient />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Banking & Credit" })).toBeTruthy()
    );

    expect(screen.getByRole("tab", { name: /Private banks/ }).getAttribute("aria-selected")).toBe(
      "true"
    );
    expect(screen.getByRole("heading", { name: "Private banks" })).toBeTruthy();
    expect(screen.getByText("Continental Trust")).toBeTruthy();
    expect(screen.getByText("Player-run")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Central banks" })).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Deposit savings at Continental Trust" })
        .getAttribute("href")
    ).toBe("/corporation/17?tab=bank#customer-deposit");
    expect(
      screen
        .getByRole("link", { name: "Apply for a loan at Continental Trust" })
        .getAttribute("href")
    ).toBe("/corporation/17?tab=bank#customer-loan");

    // Hero: account balances plus the link to the player's central bank.
    expect(screen.getByText("Liquid funds")).toBeTruthy();
    expect(screen.getAllByText(/40,000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/125,000/).length).toBeGreaterThan(0);
    const primaryLink = screen.getByRole("link", { name: /Open policy desk/ });
    expect(primaryLink.getAttribute("href")).toBe("/centralbank/usd");

    fireEvent.click(screen.getByRole("tab", { name: /Central banks/ }));
    expect(screen.getByRole("heading", { name: "Central banks" })).toBeTruthy();
    expect(screen.getByText("Bank of England")).toBeTruthy();
    expect(screen.getAllByTestId("country-flag-US").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Private banks" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Your accounts" }));
    expect(screen.getByRole("heading", { name: "Your accounts" })).toBeTruthy();
    expect(screen.getByLabelText("Savings holder for USD")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Your loans" })).toBeTruthy();
    expect(screen.getByText("Acme Industrial liquid capital")).toBeTruthy();
    expect(screen.getAllByText("Continental Trust").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Private-bank maximum/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Arrange private-bank loan" }));
    expect(screen.getByRole("heading", { name: "Arrange private-bank credit" })).toBeTruthy();
    expect(screen.getByText(/Private-bank maximum/)).toBeTruthy();
    expect(screen.getByText(/separate from bond issuance capacity/i)).toBeTruthy();
  });

  it("sorts the private-bank table by savings APY, loan rate, and health", async () => {
    render(<BankingHubClient />);
    await waitFor(() => expect(screen.getByText("Meridian Mutual")).toBeTruthy());

    const bankRows = () =>
      screen
        .getAllByRole("row")
        .filter((row) => row.textContent?.includes("Mutual") || row.textContent?.includes("Trust"));

    // Default sort: savings APY descending puts Meridian (4.00%) on top.
    expect(bankRows()[0].textContent).toContain("Meridian Mutual");

    // Estimated personal rate renders next to the posted base rate.
    expect(screen.getAllByText(/Est\. yours/).length).toBe(2);
    expect(screen.getByText(/Est\. yours 9\.00%/)).toBeTruthy();

    // Health column shows the published score.
    expect(screen.getByText("91")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Savings APY/ }));
    expect(bankRows()[0].textContent).toContain("Continental Trust");

    fireEvent.click(screen.getByRole("button", { name: /Loan rate/ }));
    expect(bankRows()[0].textContent).toContain("Meridian Mutual");

    fireEvent.click(screen.getByRole("button", { name: /Health/ }));
    expect(bankRows()[0].textContent).toContain("Continental Trust");
  });

  it("lets a player withdraw from savings held at a private bank", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url === "/api/character/savings/withdraw") {
        return {
          ok: true,
          json: async () => ({ success: true, currency: "USD", amount: 250 }),
        };
      }
      return { ok: true, json: async () => payload };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<BankingHubClient />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Banking & Credit" })).toBeTruthy()
    );
    fireEvent.click(screen.getByRole("tab", { name: "Your accounts" }));

    fireEvent.change(screen.getByLabelText("Withdrawal amount in USD"), {
      target: { value: "250" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw USD savings" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/character/savings/withdraw",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ currency: "USD", amount: 250 }),
        })
      )
    );
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
