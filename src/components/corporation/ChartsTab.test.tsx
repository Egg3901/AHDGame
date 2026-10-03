// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import ChartsTab from "./ChartsTab";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (value: number, code?: string) => `money:${value}:${code ?? "anchor"}`,
    formatPrice: (value: number, code?: string) => `price:${value}:${code ?? "anchor"}`,
    toInternalFrom: (value: number, code: string) => value / (code === "EUR" ? 5 : 4),
  }),
}));
vi.mock("@/hooks/useFeatureSeen", () => ({
  useFeatureSeen: () => ({ isNew: false, markSeen: vi.fn() }),
}));
vi.mock("./MarketSharePanel", () => ({ MarketSharePanel: () => null }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function showHistory(quote: { marketCapCurrencyCode?: string | null }) {
  const snapshot = {
    turn: 1,
    sharePrice: 40,
    marketCap: 500,
    liquidCapital: 400,
    revenue: 200,
    totalCosts: 80,
    income: 120,
    currencyCode: "USD",
    fxRateAtWrite: 2,
    marketingStrength: 30,
    dividendRate: 5,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ history: [snapshot, { ...snapshot, turn: 2, ...quote }] }),
    })
  );
  render(<ChartsTab corpId="16" />);
  await screen.findByRole("button", { name: "Share price" });
}

/** The metric table carries each series' latest value in its own row. */
function expectLatest(metric: string, value: string) {
  const row = screen.getByRole("button", { name: metric }).closest("tr");
  expect(row).not.toBeNull();
  expect(within(row!).getByText(value)).toBeTruthy();
}

describe("corporation chart currency basis", () => {
  it("uses live FX only for the latest market cap while other metrics retain snapshot FX", async () => {
    await showHistory({ marketCapCurrencyCode: "EUR" });
    expectLatest("Share price", "price:20:USD");
    expectLatest("Cash on hand", "money:200:USD");
    expectLatest("Revenue and costs", "money:100:USD");
    expectLatest("Market cap", "money:100:EUR");
  });

  it("charts the metric picked from the table", async () => {
    await showHistory({ marketCapCurrencyCode: "EUR" });
    fireEvent.click(screen.getByRole("button", { name: "Cash on hand" }));
    expect(screen.getByRole("button", { name: "Cash on hand" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(screen.getByRole("img", { name: "Cash on hand by turn" })).toBeTruthy();
  });

  it("treats an explicit null live quote currency as anchor currency", async () => {
    await showHistory({ marketCapCurrencyCode: null });
    expectLatest("Market cap", "money:500:anchor");
  });

  it("preserves the snapshot basis for legacy responses without a live quote currency", async () => {
    await showHistory({});
    expectLatest("Market cap", "money:250:USD");
  });
});
