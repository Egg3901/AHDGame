import { describe, it, expect } from "vitest";
import { nationalProvisionToView, stateProvisionToView } from "./provisionView";

describe("nationalProvisionToView", () => {
  it("splits combined labels into title + description and falls back to 'Current law'", () => {
    const view = nationalProvisionToView({
      legislationTypeName: "Electoral Reform",
      policyOptionName: "Direct Democracy Expansion Act: _Acht_ — citizens' assembly",
      currentPolicyOptionName: "Statutory Electoral Commission Act: maintain remit",
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

  it("uses 'Current law' / 'Unknown' fallbacks when names are missing", () => {
    const view = nationalProvisionToView({
      legislationTypeName: "X",
      effectDirection: 0,
      directionLabel: "Center",
    });
    expect(view.current).toEqual({ title: "Current law", description: undefined });
    expect(view.proposed).toEqual({ title: "Unknown", description: undefined });
  });
});

describe("stateProvisionToView", () => {
  it("maps separate name/description fields and resolves current law", () => {
    const view = stateProvisionToView({
      legislationTypeName: "Electoral Reform",
      policyOptionName: "Direct Democracy Expansion Act",
      policyOptionDescription: "_Acht_ — citizens' assembly",
      currentPolicyOptionName: "Statutory Electoral Commission Act",
      currentPolicyOptionDescription: "maintain remit",
      effectDirection: 1,
      effectTargetsWeighted: [],
      annualCostPerCapita: null,
      gdpPerCapitaMultiplier: null,
    });
    expect(view.proposed.description).toBe("_Acht_ — citizens' assembly");
    expect(view.current).toEqual({
      title: "Statutory Electoral Commission Act",
      description: "maintain remit",
    });
  });

  it("renders subsidy provisions proposed-only (current = null)", () => {
    const view = stateProvisionToView({
      legislationTypeName: "Subsidy",
      policyOptionName: "Grant subsidies to the tech sector",
      effectDirection: 0,
      effectTargetsWeighted: [],
      annualCostPerCapita: null,
      gdpPerCapitaMultiplier: null,
      type: "subsidy",
    });
    expect(view.current).toBeNull();
    expect(view.proposed.title).toBe("Grant subsidies to the tech sector");
  });
});
