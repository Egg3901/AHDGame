// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
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
