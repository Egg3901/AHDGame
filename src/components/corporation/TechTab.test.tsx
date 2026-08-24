/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import TechTab from "./TechTab";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    toInternalFrom: (amount: number) => amount,
    formatFull: (amount: number) => `$${Math.round(amount).toLocaleString("en-US")}`,
  }),
}));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        enabled: true,
        sectorLabel: "Corporate",
        currencyCode: "USD",
        currentDecadeId: "1953",
        isCeo: true,
        redacted: false,
        rdScore: 10,
        liquidCapital: 61_413_924,
        cashPricing: {
          dailyGrossOperatingScale: 2_635_025_294,
          defaultRevenueFraction: 0.15,
          capacityFloorApplied: true,
        },
        decades: [],
      }),
    })
  );
});

describe("TechTab cash pricing", () => {
  it("names the inputs that can move a technology's cash price", async () => {
    render(<TechTab corporationId="624" isCeo />);

    await waitFor(() => expect(screen.getByText("How cash prices work")).toBeTruthy());
    expect(screen.getByText(/15% of the corporation's \$2,635,025,294 daily gross/)).toBeTruthy();
    expect(screen.getByText(/Market cap and profit do not set the price/)).toBeTruthy();
    expect(screen.getByText(/Owned plant capacity is the minimum pricing basis/)).toBeTruthy();
    expect(screen.getByText(/Exchange rates can move the converted total/)).toBeTruthy();
  });
});
