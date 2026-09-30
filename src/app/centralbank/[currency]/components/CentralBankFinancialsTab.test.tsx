/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CentralBankFinancialsTab } from "./CentralBankFinancialsTab";
import type { BalanceSheet } from "./centralBankTypes";
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    currencyCode: "USD",
    displayCurrencyPreference: "native",
    forexRates: null,
    formatAmount: (n: number) => String(n),
    toInternalFrom: (n: number) => n,
  }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const sheet: BalanceSheet = {
  homeCurrency: "USD",
  totalDeposits: 10000,
  bankReserves: 800,
  forexRevenue: 1000,
  totalLoansOutstanding: 0,
  systemCap: 7560,
  availableCapacity: 7560,
  reservePoolTransferMaxToLending: 500,
  reservePoolTransferMaxToForex: 400,
  reservePoolTransferCooldownRemaining: 0,
  reservePortfolio: {
    homeCurrency: "USD",
    homeReserveBalance: 800,
    spreadFeeReserveBalances: {},
    spreadFeeReservesHomeValue: 0,
    totalReservesHomeValue: 800,
    entries: [],
    foreignEntries: [],
  },
};
describe("reserve-pool UI command identity", () => {
  it("retains the original ID after network failure and allocates a new ID after success", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(Error("Synthetic network loss"))
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ amount: 100 }) });
    vi.stubGlobal("fetch", fetchMock);
    const changed = vi.fn();
    render(
      <CentralBankFinancialsTab
        countryId="US"
        balanceSheet={sheet}
        bankFinancials={null}
        isChair
        isAdmin={false}
        chairControlsLocked={false}
        onChanged={changed}
      />
    );
    const amount = screen.getByRole("spinbutton", { name: /Amount \(USD\)/ });
    fireEvent.change(amount, { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
    await screen.findByText("Synthetic network loss");
    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    const first = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).operationId).toBe(first.operationId);
    expect(first.operationId).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    fireEvent.change(amount, { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).operationId).not.toBe(first.operationId);
  });
});
