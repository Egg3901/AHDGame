/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import OverviewTab from "./OverviewTab";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (n: number) => `$${Math.round(n)}`,
    formatFull: (n: number) => `$${Math.round(n)}.00`,
    formatPriceIn: (n: number) => `$${n.toFixed(2)}`,
    formatPrice: (n: number) => `$${n.toFixed(2)}`,
    toInternalFrom: (n: number) => n,
  }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/components/economy/CorpEconomicModelBadge", () => ({
  CorpEconomicModelBadge: () => null,
}));
vi.mock("@/components/time/LocalTime", () => ({ LocalTime: () => <span>date</span> }));

function sector(i: number, revenue: number) {
  return {
    _id: `s${i}`,
    stateId: `S${i}`,
    stateName: `Region ${i}`,
    sectorType: "energy",
    sectorLabel: "Energy",
    revenue,
    financialRevenue: revenue,
    profit: revenue / 10,
    effectiveProfitMargin: 10,
    marketSharePercent: 20,
    workers: 5,
    currentGrowthRate: 2,
  };
}

const corporation = {
  _id: "c1",
  sequentialId: 7,
  name: "Keystone Industries",
  countryId: "US",
  type: "energy",
  isPrivate: false,
  liquidCapital: 1_000_000,
  liquidCurrencyCode: "USD",
  sharePrice: 10,
  marketCapitalization: 100_000_000,
  totalShares: 10_000_000,
  publicFloat: 4_000_000,
  dividendRate: 5,
  marketingStrength: 10,
  marketingStrengthGrowth: 1,
  logisticsStrength: 1,
  logisticsStrengthNetChange: 0,
  rdScore: 2,
  rdScoreNetChange: 0.5,
  headquartersStateName: "Pennsylvania",
  legalStructureLabel: "C-Corp",
  createdAt: "2026-10-01T00:00:00Z",
  shareholders: [
    { characterId: "me", name: "Avery Lane", shares: 1_000_000, sequentialId: 1 },
    { characterId: "x", name: "Dana Ross", shares: 5_000_000, sequentialId: 2 },
  ],
};

const financials = {
  totalRevenue: 48_000,
  operatingIncome: 9_600,
  income: 7_200,
  totalCosts: 38_400,
  dividendDistribution: 360,
  effectiveDividendRate: 5,
  currentGrowthRate: 2,
  growthRateIsRealized: false,
};

function renderOverview(props: Record<string, unknown> = {}) {
  const handlers = { onTabChange: vi.fn(), onPeriodViewChange: vi.fn(), onTrade: vi.fn() };
  render(
    <OverviewTab
      corporation={corporation as never}
      financials={financials as never}
      balanceSheet={null}
      bondInfo={null}
      sectors={Array.from({ length: 12 }, (_, i) => sector(i + 1, (i + 1) * 2_400)) as never}
      corpId="7"
      periodView="turn"
      financialFogOfWar={null}
      isCeo={false}
      myCharacterId="me"
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

describe("OverviewTab", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    );
  });

  it("lists sectors largest first and expands past the first ten", () => {
    renderOverview();
    const rows = () =>
      screen.getAllByRole("row").filter((r) => within(r).queryByText(/^Region \d+$/));
    expect(rows()).toHaveLength(10);
    expect(within(rows()[0]).getByText("Region 12")).toBeTruthy();
    fireEvent.click(screen.getByText("Show all 12"));
    expect(rows()).toHaveLength(12);
  });

  it("re-sorts when a column header is clicked", () => {
    renderOverview();
    fireEvent.click(screen.getByRole("button", { name: /Revenue\/turn/ }));
    const first = screen.getAllByRole("row").find((r) => within(r).queryByText(/^Region \d+$/))!;
    expect(within(first).getByText("Region 1")).toBeTruthy();
  });

  it("shows the viewer's position with a trade action", () => {
    const { onTrade } = renderOverview();
    expect(screen.getByText("Shares held")).toBeTruthy();
    expect(screen.getByText("1,000,000")).toBeTruthy();
    fireEvent.click(screen.getByText("Buy / sell"));
    expect(onTrade).toHaveBeenCalled();
  });

  it("switches the money period from the statistics header", () => {
    const { onPeriodViewChange } = renderOverview();
    fireEvent.click(screen.getByRole("radio", { name: "Daily" }));
    expect(onPeriodViewChange).toHaveBeenCalledWith("daily");
  });

  it("says plainly when a private corporation's books are not disclosed", () => {
    renderOverview({ financials: null, corporation: { ...corporation, isPrivate: true } });
    expect(screen.getByText(/disclosed to the CEO only/)).toBeTruthy();
    expect(screen.queryByText("Key statistics")).toBeNull();
  });
});
