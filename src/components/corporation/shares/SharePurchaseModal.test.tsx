/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { CorporationDetail } from "../CorporationPageTypes";
import SharePurchaseModal from "./SharePurchaseModal";

const fx = vi.hoisted(() => ({ rates: { USD: 1, GBP: 1 } as Record<string, number> | null }));
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    toDisplay: (n: number) => n,
    toInternal: (n: number) => n,
    toInternalFrom: (n: number) => n,
    toLocalOf: (n: number) => n,
    inputSymbol: "$",
    formatAmount: (n: number) => String(n),
    formatPrice: (n: number) => String(n),
    forexRates: fx.rates,
    forexSpreadStrengths: {},
    ratesLoading: false,
  }),
}));
vi.mock("@/hooks/useWorldFlags", () => ({ useWorldFlags: () => ({ euroMonetaryUnion: false }) }));

function corporation(overrides: Partial<CorporationDetail> = {}): CorporationDetail {
  return {
    _id: "target",
    name: "Target",
    type: "manufacturing",
    typeLabel: "Manufacturing",
    countryId: "US",
    currentTurn: 200,
    headquartersState: "CA",
    headquartersStateName: "California",
    liquidCapital: 0,
    liquidCurrencyCode: "USD",
    marketingBudget: 0,
    ceoSalary: 0,
    marketingStrength: 0,
    logisticsBudget: 0,
    logisticsStrength: 0,
    rdBudget: 0,
    rdScore: 0,
    marketCapitalization: 1_000_000,
    sharePrice: 1,
    totalShares: 1_000_000,
    publicFloat: 500_000,
    shareholders: [],
    dividendRate: 0,
    lastDividendChange: null,
    lastShareIssuance: null,
    ceoVacant: false,
    pendingCeoCharacterId: null,
    createdAt: "2026-01-01",
    ceoShareWindow: {
      capShares: 100_000,
      acquiredShares: 0,
      reservedShares: 0,
      remainingShares: 100_000,
      freesUpInTurns: 0,
      capPercent: 10,
      windowTurns: 120,
    },
    ...overrides,
  };
}
function setup(overrides: Partial<ComponentProps<typeof SharePurchaseModal>> = {}) {
  render(
    <SharePurchaseModal
      corporation={corporation()}
      corpId="target"
      myCharacterId="ceo"
      myCashOnHand={1_000_000}
      myShares={0}
      myCorporation={null}
      myOrders={[]}
      marketOrders={[]}
      isCeo
      onClose={() => {}}
      onSuccess={() => {}}
      {...overrides}
    />
  );
}
function enterQuantity(value: number) {
  const input = screen.getByPlaceholderText("Quantity");
  fireEvent.change(input, { target: { value: String(value) } });
  fireEvent.blur(input);
  return (input as HTMLInputElement).value;
}
afterEach(() => {
  cleanup();
  fx.rates = { USD: 1, GBP: 1 };
});

describe("personal CEO market purchases", () => {
  it("caps a first purchase at the allowance even with no history", () => {
    setup();
    expect(enterQuantity(100_001)).toBe("100000");
    expect(enterQuantity(100_000)).toBe("100000");
  });
  it("shows filled and reserved shares separately and caps at the remainder", () => {
    const corp = corporation();
    setup({
      corporation: corporation({
        ceoShareWindow: {
          ...corp.ceoShareWindow!,
          acquiredShares: 40_000,
          reservedShares: 35_000,
          remainingShares: 25_000,
        },
      }),
    });
    expect(screen.getByText(/35,000 reserved/)).toBeTruthy();
    expect(enterQuantity(25_001)).toBe("25000");
  });
  it("keeps the allowance when foreign exchange rates are missing", () => {
    fx.rates = null;
    setup({ myCurrencyBalances: { GBP: 1_000_000 }, myHomeCurrency: "USD" });
    fireEvent.click(screen.getByRole("button", { name: "$0.00" }));
    fireEvent.click(screen.getByText("GBP"));
    expect(enterQuantity(200_000)).toBe("100000");
    expect(enterQuantity(200_000)).toBe("100000");
  });
  it.each(["corporation", "bank"] as const)(
    "bypasses the personal cap for %s purchases",
    (mode) => {
      setup({
        myCorporation: {
          id: "buyer",
          name: "Buyer",
          liquidCapital: 1_000_000,
          liquidCurrencyCode: "USD",
          isInvestmentBank: true,
        },
      });
      fireEvent.click(screen.getByText(mode === "bank" ? "Investment bank" : "Buyer"));
      expect(enterQuantity(200_000)).toBe("200000");
    }
  );
  it.each([{ isPrivate: true }, { ceoVacant: true }])(
    "ignores a stale window for an exempt corporation: %j",
    (overrides) => {
      setup({ corporation: corporation(overrides) });
      expect(enterQuantity(200_000)).toBe("200000");
      expect(screen.queryByText(/CEO purchase limit/)).toBeNull();
    }
  );
  it("still obeys affordability and float", () => {
    setup({ myCashOnHand: 500, corporation: corporation({ publicFloat: 300 }) });
    expect(enterQuantity(200_000)).toBe("300");
  });
  it("still obeys affordability below the allowance", () => {
    setup({ myCashOnHand: 500 });
    expect(enterQuantity(200_000)).toBe("500");
  });
  it("does not cap a non-CEO", () => {
    setup({ isCeo: false });
    expect(enterQuantity(200_000)).toBe("200000");
    expect(screen.queryByText(/CEO purchase limit/)).toBeNull();
  });
});
