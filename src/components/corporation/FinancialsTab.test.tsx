/** @vitest-environment happy-dom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import FinancialsTab from "./FinancialsTab";
import type { CorporationDetail, Financials, FinancialFogMeta } from "./CorporationPageTypes";
import messages from "../../../messages/en/corporations.json";

vi.mock("next-intl", () => ({
  useTranslations:
    () => (key: keyof typeof messages.corporations.arrears, values?: { turn: number }) =>
      messages.corporations.arrears[key].replace("{turn}", String(values?.turn ?? "")),
}));

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (n: number) => `M${Math.round(n)}`,
    toInternalFrom: (n: number) => n,
  }),
}));
vi.mock("./GroupOverviewCard", () => ({ GroupOverviewCard: () => null }));

const financials = {
  totalRevenue: 128000,
  maintenanceCosts: 65900,
  laborCosts: 10800,
  freightCosts: 77700,
  freightIncome: 120,
  growthCosts: 0,
  marketingCosts: 22000,
  logisticsCosts: 1100,
  rdCosts: 19000,
  ceoSalaryCost: 0,
  pensionContributionCost: 0,
  pensionTopUpCost: 0,
  pensionSchemesInDeficit: 0,
  regulatoryBurden: 3500,
  operatingCosts: 200000,
  operatingIncome: -72000,
  federalTax: 0,
  stateTax: 0,
  federalTaxByCountry: {},
  bondInterestCost: 1100,
  bondCouponIncome: 0,
  dividendIncomeReceived: 0,
  governmentBondSubsidy: 0,
  imfFacilityPaymentDaily: 0,
  imfFacilityReceiptsDaily: 0,
  totalCosts: 201100,
  income: -73100,
  realizedIncome: -79500,
  realizedDividendPaid: 0,
  realizedIncomeTurn: 23,
  dividendDistribution: 0,
  currentGrowthRate: 0,
} as Financials;

describe("corporation income statement", () => {
  it("shows arrears separately without annualizing the balance or last-turn payment", () => {
    const props = {
      corporation: { countryId: "US", liquidCurrencyCode: "USD" } as CorporationDetail,
      financials: { ...financials, arrears: { turn: 23, paidLastTurn: 123, remaining: 456 } },
      balanceSheet: null,
      bondInfo: null,
      corpId: "test",
      periodView: "daily" as const,
      onPeriodViewChange: vi.fn(),
      sectors: [],
    };
    const view = render(<FinancialsTab {...props} />);
    expect(screen.getByText("Arrears paid last turn")).toBeTruthy();
    expect(screen.getByText("Arrears remaining")).toBeTruthy();
    expect(screen.getByText("M123")).toBeTruthy();
    expect(screen.getByText("M456")).toBeTruthy();
    view.rerender(<FinancialsTab {...props} periodView="annual" />);
    expect(screen.getByText("M123")).toBeTruthy();
    expect(screen.getByText("M456")).toBeTruthy();
    view.rerender(<FinancialsTab {...props} periodView="turn" />);
    expect(screen.getByText("M123")).toBeTruthy();
    expect(screen.getByText("M456")).toBeTruthy();
    view.rerender(<FinancialsTab {...props} financialFogOfWar={{} as FinancialFogMeta} />);
    expect(screen.queryByText("Arrears remaining")).toBeNull();
    view.rerender(<FinancialsTab {...props} financials={financials} />);
    expect(screen.queryByText("Arrears remaining")).toBeNull();
  });
  it("shows the estimate-to-recorded change before a retained loss", () => {
    render(
      <FinancialsTab
        corporation={{ countryId: "US", liquidCurrencyCode: "USD" } as CorporationDetail}
        financials={financials}
        balanceSheet={null}
        bondInfo={null}
        corpId="test"
        periodView="daily"
        onPeriodViewChange={vi.fn()}
        sectors={[]}
      />
    );
    expect(screen.getAllByText("Freight charges")).toHaveLength(2);
    expect(screen.getByText("Freight revenue")).toBeTruthy();
    expect(screen.getByText("Net income, current estimate")).toBeTruthy();
    expect(screen.getByText("Difference from current estimate")).toBeTruthy();
    expect(screen.getByText("-M6400")).toBeTruthy();
    expect(screen.getByText(/Current estimates use today's sectors and budgets/)).toBeTruthy();
  });
});
