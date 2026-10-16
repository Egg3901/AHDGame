// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TopProducersConsumers from "./TopProducersConsumers";

const otherDemand = {
  name: "Other demand (including marketing)",
  type: "system" as const,
  units: 80,
  description: "Global residual, not per-company marketing attribution.",
};

afterEach(cleanup);

describe("advertising consumer display", () => {
  it("shows the residual even when there are no plant consumers", () => {
    render(
      <TopProducersConsumers
        topProducers={[]}
        topConsumers={[]}
        syntheticDemandSources={[otherDemand]}
        unit="campaigns"
        commodity="advertising"
      />
    );

    expect(screen.getByText(otherDemand.name)).toBeTruthy();
    expect(screen.getByText("80 campaigns")).toBeTruthy();
  });

  it("preserves plant-only consumer volumes without promising separate local marketing totals", () => {
    render(
      <TopProducersConsumers
        topProducers={[]}
        topConsumers={[{ corpId: "retailer", name: "Retailer", units: 20 }]}
        syntheticDemandSources={[]}
        unit="campaigns"
        commodity="advertising"
        marketLabel="UK Market"
      />
    );

    expect(screen.getByText("20 campaigns")).toBeTruthy();
    expect(screen.getByText(/plant inputs only; excludes marketing budgets/)).toBeTruthy();
    expect(screen.queryByText(/shown separately/)).toBeNull();
    expect(screen.queryByText(otherDemand.name)).toBeNull();
  });
});

describe("marketing budget list", () => {
  it("renders and paginates budgets independently of plant demand", () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({
      corpId: String(i),
      name: "Advertiser " + i,
      sequentialId: 100 + i,
      dailyBudgetAnchor: 1000 - i,
    }));
    const { rerender } = render(
      <TopProducersConsumers
        topProducers={[]}
        topConsumers={[]}
        syntheticDemandSources={[]}
        unit="campaigns"
        commodity="advertising"
        marketingBudgets={rows}
        marketLabel="UK Market"
      />
    );
    expect(screen.getByText("Marketing budgets by company")).toBeTruthy();
    expect(screen.getByText(/configured daily budgets/i)).toBeTruthy();
    expect(screen.getByText(/not settled spending or recorded demand/i)).toBeTruthy();
    expect(screen.getByText(/funding and delivery/i)).toBeTruthy();
    expect(screen.getByText(/headquarters/i)).toBeTruthy();
    expect(screen.getByText("Advertiser 0").closest("a")?.getAttribute("href")).toBe(
      "/corporation/100"
    );
    expect(screen.getByText("₳1,000/day")).toBeTruthy();
    expect(screen.queryByText("Advertiser 10")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText("Advertiser 10")).toBeTruthy();
    expect(screen.queryByText("Advertiser 0")).toBeNull();
    // Scope changes reset pagination without hiding the only result.
    rerender(
      <TopProducersConsumers
        topProducers={[]}
        topConsumers={[]}
        syntheticDemandSources={[]}
        unit="campaigns"
        commodity="advertising"
        marketingBudgets={rows.slice(0, 1)}
        marketLabel="US Market"
      />
    );
    expect(screen.getByText("Advertiser 0")).toBeTruthy();
  });
  it("shows an empty message only for a loaded advertising budget list", () => {
    const { rerender } = render(
      <TopProducersConsumers
        topProducers={[]}
        topConsumers={[]}
        syntheticDemandSources={[]}
        unit="campaigns"
        commodity="advertising"
        marketingBudgets={[]}
      />
    );
    expect(screen.getByText(/No companies with positive marketing budgets/)).toBeTruthy();
    rerender(
      <TopProducersConsumers
        topProducers={[]}
        topConsumers={[]}
        syntheticDemandSources={[]}
        unit="tonnes"
        commodity="steel"
        marketingBudgets={[]}
      />
    );
    expect(screen.queryByText("Marketing budgets by company")).toBeNull();
  });
});
