import { describe, it, expect } from "vitest";
import { provisionToView } from "./provisionView";

describe("provisionToView", () => {
  it("maps structured labels to the card's title + description", () => {
    const view = provisionToView({
      legislationTypeName: "Electoral Reform",
      proposed: {
        name: "Direct Democracy Expansion Act",
        explanation: "_Acht_ — citizens' assembly",
      },
      current: { name: "Statutory Electoral Commission Act", explanation: "maintain remit" },
      effectDirection: 1,
      directionLabel: "Left",
    });
    expect(view.proposed).toEqual({
      title: "Direct Democracy Expansion Act",
      description: "_Acht_ — citizens' assembly",
    });
    expect(view.current).toEqual({
      title: "Statutory Electoral Commission Act",
      description: "maintain remit",
    });
  });

  it("falls back to 'Current law' when no current law resolved", () => {
    const view = provisionToView({
      legislationTypeName: "X",
      proposed: { name: "Unknown" },
      effectDirection: 0,
      directionLabel: "Center",
    });
    expect(view.current).toEqual({ title: "Current law", description: undefined });
    expect(view.proposed).toEqual({ title: "Unknown", description: undefined });
  });

  it("renders subsidy provisions proposed-only (current = null)", () => {
    const view = provisionToView({
      legislationTypeName: "Subsidy",
      proposed: { name: "Grant subsidies to the tech sector" },
      effectDirection: 0,
      directionLabel: "Center",
      type: "subsidy",
      effectTargetsWeighted: [],
      annualCostPerCapita: null,
      gdpPerCapitaMultiplier: null,
    });
    expect(view.current).toBeNull();
    expect(view.proposed.title).toBe("Grant subsidies to the tech sector");
  });

  it("renders end-subsidy provisions proposed-only too", () => {
    const view = provisionToView({
      legislationTypeName: "Subsidy Repeal",
      proposed: { name: "End subsidies for the tech sector" },
      effectDirection: 0,
      directionLabel: "Center",
      type: "end_subsidy",
    });
    expect(view.current).toBeNull();
  });

  it("carries the fiscal panel and nationalization detail through unchanged", () => {
    const view = provisionToView({
      legislationTypeName: "Health",
      proposed: { name: "Universal" },
      effectDirection: -1,
      directionLabel: "Left",
      fiscal: { currencyCode: "RUB", netDelta: 12 },
    });
    expect(view.fiscal).toEqual({ currencyCode: "RUB", netDelta: 12 });
  });
});
