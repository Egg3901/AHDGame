/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PortfolioChart } from "./PortfolioChart";
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ resolveDisplayAt: (value: number) => ({ value, symbol: "$" }) }),
}));
afterEach(cleanup);
describe("portfolio bucket chart", () => {
  it("plots only measured bucket history and preserves recorded zero values", () => {
    const { rerender } = render(
      <PortfolioChart
        view="shortStocks"
        history={[
          { turn: 1, totalValue: 100, stockValue: 100 },
          {
            turn: 2,
            totalValue: 100,
            stockValue: 100,
            shortTermStockValue: 0,
            longTermStockValue: 100,
          },
          {
            turn: 3,
            totalValue: 100,
            stockValue: 100,
            shortTermStockValue: 25,
            longTermStockValue: 75,
          },
        ]}
      />
    );
    expect(screen.getByRole("img", { name: "Short Term Holdings history" })).toBeTruthy();
    expect(screen.queryByText("T1")).toBeNull();
    expect(screen.getByText("T2")).toBeTruthy();
    rerender(
      <PortfolioChart view="longStocks" history={[{ turn: 1, totalValue: 100, stockValue: 100 }]} />
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/Not enough data yet/)).toBeTruthy();
  });
});
