import { describe, expect, it } from "vitest";
import {
  economicExperimentCliArgs,
  economicExperimentConfigSet,
  parseOptionalBoolean,
} from "./economicExperiment";

describe("economic experiment configuration", () => {
  it("preserves explicit false for controlled baseline runs", () => {
    expect(
      economicExperimentConfigSet({
        freightSettlementMode: "shadow",
        canonicalFreightBillingEnabled: false,
        shortageResponsiveSourcingEnabled: false,
        indexFundBondLiquidityEnabled: false,
        equityLiquidityFacilityEnabled: false,
        nppMarketCoverageEnabled: false,
        nppFragileMarketSupplyEnabled: false,
      })
    ).toEqual({
      freightSettlementMode: "shadow",
      canonicalFreightBillingEnabled: false,
      shortageResponsiveSourcingEnabled: false,
      indexFundBondLiquidityEnabled: false,
      equityLiquidityFacilityEnabled: false,
      nppMarketCoverageEnabled: false,
      nppFragileMarketSupplyEnabled: false,
    });
    expect(
      economicExperimentCliArgs({
        freightSettlementMode: "shadow",
        canonicalFreightBillingEnabled: false,
        shortageResponsiveSourcingEnabled: false,
        indexFundBondLiquidityEnabled: false,
        equityLiquidityFacilityEnabled: false,
        nppMarketCoverageEnabled: false,
        nppFragileMarketSupplyEnabled: false,
      })
    ).toEqual([
      "--freight-settlement=shadow",
      "--canonical-freight-billing=false",
      "--shortage-responsive-sourcing=false",
      "--index-fund-bond-liquidity=false",
      "--equity-liquidity=false",
      "--npp-market-coverage=false",
      "--npp-fragile-market-supply=false",
    ]);
  });

  it("omits unspecified fields so existing simulation behavior is unchanged", () => {
    expect(economicExperimentConfigSet({})).toEqual({});
    expect(economicExperimentCliArgs({})).toEqual([]);
  });

  it("parses only explicit booleans", () => {
    expect(parseOptionalBoolean(undefined, "flag")).toBeUndefined();
    expect(parseOptionalBoolean("true", "flag")).toBe(true);
    expect(parseOptionalBoolean("false", "flag")).toBe(false);
    expect(() => parseOptionalBoolean("yes", "flag")).toThrow("must be true or false");
  });
});
