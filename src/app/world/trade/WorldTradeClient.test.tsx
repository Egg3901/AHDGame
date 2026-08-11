/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import WorldTradeClient from "./WorldTradeClient";
import type { WorldTradeLedger } from "@/lib/trade/queries/worldTradeLedger";

const ledger: WorldTradeLedger = {
  turn: 412,
  updatedAt: "2026-06-16T00:00:00.000Z",
  headline: {
    worldVolume: 105000,
    largestSurplus: { code: "US", value: 55000 },
    largestDeficit: { code: "CN", value: -55000 },
    surplusCount: 1,
    deficitCount: 1,
    mostTradedGood: { key: "steel", label: "Steel & Metals", volume: 80000 },
    verdict: "IMBALANCED",
    verdictRatio: 0.52,
  },
  nations: [],
  commodities: [],
  bilateral: {},
  flows: {},
  meta: {
    countries: [
      { code: "US", name: "United States", hue: "#b9933f" },
      { code: "CN", name: "China", hue: "#d8b25e" },
    ],
  },
};

describe("WorldTradeClient", () => {
  it("renders the masthead title and live turn", () => {
    render(<WorldTradeClient ledger={ledger} />);
    expect(screen.getByText("World Trade Ledger")).toBeTruthy();
    expect(screen.getByText(/Live · Turn 412/)).toBeTruthy();
    expect(screen.getByText("IMBALANCED")).toBeTruthy();
  });

  it("switches the active view tab on click", () => {
    render(<WorldTradeClient ledger={ledger} />);
    const nations = screen.getByRole("tab", { name: "By Nation" });
    const commodities = screen.getByRole("tab", { name: "By Commodity" });
    expect(nations.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(commodities);
    expect(commodities.getAttribute("aria-selected")).toBe("true");
    expect(nations.getAttribute("aria-selected")).toBe("false");
  });

  it("shows an empty state when there is no ledger", () => {
    render(<WorldTradeClient ledger={null} />);
    expect(screen.getByText(/No trade data yet/)).toBeTruthy();
  });
});
