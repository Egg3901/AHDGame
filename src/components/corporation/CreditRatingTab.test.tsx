/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CreditRatingTab from "./CreditRatingTab";
import type { BondInfo, CorporationDetail } from "./CorporationPageTypes";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (value: number) => String(value),
    toInternalFrom: (value: number) => value,
  }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const corporation = {
  liquidCapital: 50_000,
  liquidCurrencyCode: "USD",
} as CorporationDetail;

const baseBondInfo = {
  bonds: [],
  imfFacility: null,
  totalDebt: 0,
  isCeo: false,
  cooldownTurnsRemaining: 0,
  currentTurn: 10,
} as unknown as BondInfo;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) }));
});

describe("CreditRatingTab", () => {
  it("renders a fallback for rating-only private bond data", () => {
    render(
      <CreditRatingTab
        bondInfo={{ ...baseBondInfo, creditRating: { rating: "AAA" } } as BondInfo}
        bondLoading={false}
        corporation={corporation}
        corpId="corp-1"
      />
    );

    expect(screen.getByText("Credit rating data not available.")).toBeTruthy();
  });

  it("shows n/a for missing coupon figures in an otherwise complete rating", () => {
    render(
      <CreditRatingTab
        bondInfo={
          {
            ...baseBondInfo,
            creditRating: {
              rating: "AAA",
              compositeScore: 92,
              components: {
                debtToEquity: 100,
                interestCoverage: 100,
                profitability: 80,
                liquidity: 90,
              },
            },
          } as BondInfo
        }
        bondLoading={false}
        corporation={corporation}
        corpId="corp-1"
      />
    );

    expect(screen.getByText("Leverage rating")).toBeTruthy();
    expect(screen.getByText("n/a")).toBeTruthy();
  });
});
