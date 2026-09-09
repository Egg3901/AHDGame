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
  await screen.findByText("Current");
}

function expectCurrent(value: string) {
  const container = screen.getByText("Current").parentElement;
  expect(container).not.toBeNull();
  expect(within(container!).getByText(value)).toBeTruthy();
}

describe("corporation chart currency basis", () => {
  it("uses live FX only for the latest market cap while other metrics retain snapshot FX", async () => {
    await showHistory({ marketCapCurrencyCode: "EUR" });
    expectCurrent("price:20:USD");
    fireEvent.click(screen.getByRole("button", { name: "Cash on Hand" }));
    expectCurrent("money:200:USD");
    fireEvent.click(screen.getByRole("button", { name: "Revenue & Costs" }));
    expectCurrent("money:100:USD");
    fireEvent.click(screen.getByRole("button", { name: "Market Cap" }));
    expectCurrent("money:100:EUR");
  });

  it("treats an explicit null live quote currency as anchor currency", async () => {
    await showHistory({ marketCapCurrencyCode: null });
    fireEvent.click(screen.getByRole("button", { name: "Market Cap" }));
    expectCurrent("money:500:anchor");
  });

  it("preserves the snapshot basis for legacy responses without a live quote currency", async () => {
    await showHistory({});
    fireEvent.click(screen.getByRole("button", { name: "Market Cap" }));
    expectCurrent("money:250:USD");
  });
});
