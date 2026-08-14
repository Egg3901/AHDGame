/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FundTradePanel } from "./FundTradePanel";

afterEach(cleanup);

const DDM_PER_ANCHOR = 4.76;

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    // Home-preference DD viewer: ₳ → Marks. Matches ticket #1072 (buy M376 vs
    // redeem showing a dollar face amount with the wrong currency).
    formatFull: (n: number) => `M${Math.round(n * DDM_PER_ANCHOR)}`,
    formatPrice: (n: number) => `M${(n * DDM_PER_ANCHOR).toFixed(2)}`,
    forexEnabled: true,
    forexRates: { USD: 1, DDM: DDM_PER_ANCHOR },
    ratesLoading: false,
    toInternalFrom: (n: number) => n,
  }),
}));

describe("FundTradePanel currency display (ticket #1072)", () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ character: null }),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("quotes subscribe cost and redeem payout in the same display currency", () => {
    render(
      <FundTradePanel
        fundId="global_sector_defense"
        quotedNav={79}
        anchorCurrencyCode="USD"
        status="active"
        myUnits={1}
        myLegacyUnits={0}
        onSuccess={() => {}}
      />
    );

    expect(screen.getByText("Estimated cost").nextElementSibling?.textContent).toBe("M376");
    expect(screen.queryByText("$79.00")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Redeem" }));

    expect(screen.getByText("Quoted payout").nextElementSibling?.textContent).toBe("M376");
    expect(screen.queryByText("$79.00")).toBeNull();
  });
});
