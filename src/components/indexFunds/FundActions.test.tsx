/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FundActions } from "./FundActions";
import { BondHoldingsPanel } from "./BondHoldingsPanel";
import { ConstituentsPanel } from "./ConstituentsPanel";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    forexEnabled: false,
    ratesLoading: false,
    formatFull: (n: number) => `$${n}`,
    formatPrice: (n: number) => `$${n}`,
    toInternalFrom: (n: number) => n,
  }),
}));
vi.mock("@/hooks/useWorldFlags", () => ({ useWorldFlags: () => ({}) }));
const fmt = (n: number) => `$${n}`;
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("fund purchase dialog", () => {
  it("opens from the top action and submits the selected corporation account", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => ({
      ok: true,
      json: async () =>
        init?.method === "POST" ? { success: true } : { character: { cashOnHand: 500 } },
    }));
    vi.stubGlobal("fetch", fetch);
    const onSuccess = vi.fn();
    render(
      <FundActions
        fundId="fund"
        quotedNav={10}
        anchorCurrencyCode="USD"
        status="active"
        myUnits={0}
        myLegacyUnits={0}
        onSuccess={onSuccess}
        corporations={[
          {
            id: "123456789012345678901234",
            name: "Test corporation",
            currencyCode: "USD",
            liquidCapital: 100,
            units: 3,
          },
        ]}
      />
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Buy fund units" }));
    expect(screen.getByRole("dialog", { name: "Trade fund units" })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Investment account" }), {
      target: { value: "123456789012345678901234" },
    });
    fireEvent.change(screen.getByLabelText("Units (whole numbers)"), { target: { value: "2" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Subscribe" }).at(-1)!);
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const post = fetch.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
      corporationId: "123456789012345678901234",
      units: 2,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("rejects fractional units without sending a trade", async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ character: { cashOnHand: 500 } }),
    }));
    vi.stubGlobal("fetch", fetch);
    render(
      <FundActions
        fundId="fund"
        quotedNav={10}
        anchorCurrencyCode="USD"
        status="active"
        myUnits={0}
        myLegacyUnits={0}
        onSuccess={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Buy fund units" }));
    await waitFor(() =>
      expect(screen.getByText("Your cash").nextElementSibling?.textContent).toBe("$500")
    );
    fireEvent.change(screen.getByLabelText("Units (whole numbers)"), { target: { value: "1.5" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Subscribe" }).at(-1)!);
    expect(screen.getByRole("alert").textContent).toContain("whole unit");
  });
});

describe("fund holdings pagination", () => {
  it("shows ten bond holdings and lets mobile and desktop navigate the remainder", () => {
    render(
      <BondHoldingsPanel
        holdings={Array.from({ length: 12 }, (_, i) => ({
          bondId: `bond-${i}`,
          sequentialId: i,
          issuerName: `Issuer ${i}`,
          units: 1,
          couponRate: 5,
          maturityTurn: 10,
          valueAnchor: 100,
          issuerType: "sovereign" as const,
          countryId: "US",
          corporationId: null,
          marketPrice: 1,
        }))}
        formatAmount={fmt}
        ccy="USD"
      />
    );
    expect(screen.getByText("Issuer 0")).toBeTruthy();
    expect(screen.queryByText("Issuer 10")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Issuer 10")).toBeTruthy();
    expect(screen.queryByText("Issuer 0")).toBeNull();
  });
  it("paginates actual and target constituents independently without changing portfolio totals", () => {
    const holdings = Array.from({ length: 12 }, (_, i) => ({
      corporationId: `corp-${i}`,
      sequentialId: i,
      corporationName: `Company ${i}`,
      tickerSymbol: `C${i}`,
      shares: 1,
      lastValueAnchor: 100,
      avgCostPerShareAnchor: 100,
      targetWeight: 1 / 12,
    }));
    render(
      <ConstituentsPanel
        holdings={holdings}
        targetConstituents={holdings}
        formatAmount={fmt}
        formatPrice={fmt}
        ccy="USD"
      />
    );
    expect(screen.queryByText("Company 10")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getAllByText("Company 10")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Target index" }));
    expect(screen.queryByText("Company 10")).toBeNull();
    expect(screen.getByText("1 / 2 (12 total)")).toBeTruthy();
  });
});
