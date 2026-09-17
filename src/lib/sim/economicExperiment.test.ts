import { describe, expect, it } from "vitest";
import {
  DEPRECATED_EQUITY_LIQUIDITY_CLI_FLAG,
  EQUITY_LIQUIDITY_FACILITY_CLI_FLAG,
  economicExperimentCliArgs,
  economicExperimentConfigSet,
  isGameplayOverrideArg,
  parseEquityLiquidityFacilityEnabled,
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
      "--equity-liquidity-facility=false",
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

  it("emits the canonical equity liquidity facility flag", () => {
    expect(EQUITY_LIQUIDITY_FACILITY_CLI_FLAG).toBe("equity-liquidity-facility");
    expect(economicExperimentCliArgs({ equityLiquidityFacilityEnabled: true })).toEqual([
      "--equity-liquidity-facility=true",
    ]);
    expect(economicExperimentCliArgs({ equityLiquidityFacilityEnabled: false })).toEqual([
      "--equity-liquidity-facility=false",
    ]);
  });

  it("parses the canonical equity flag with explicit true and false", () => {
    const read = (flag: string) =>
      ({ "equity-liquidity-facility": "true" })[flag] as string | undefined;
    expect(parseEquityLiquidityFacilityEnabled(read)).toBe(true);
    const readFalse = (flag: string) =>
      ({ "equity-liquidity-facility": "false" })[flag] as string | undefined;
    expect(parseEquityLiquidityFacilityEnabled(readFalse)).toBe(false);
  });

  it("falls back to the deprecated equity alias and prefers canonical", () => {
    const aliasOnly = (flag: string) =>
      flag === DEPRECATED_EQUITY_LIQUIDITY_CLI_FLAG ? "true" : undefined;
    expect(parseEquityLiquidityFacilityEnabled(aliasOnly)).toBe(true);
    const aliasFalse = (flag: string) =>
      flag === DEPRECATED_EQUITY_LIQUIDITY_CLI_FLAG ? "false" : undefined;
    expect(parseEquityLiquidityFacilityEnabled(aliasFalse)).toBe(false);
    const both = (flag: string) =>
      flag === EQUITY_LIQUIDITY_FACILITY_CLI_FLAG
        ? "false"
        : flag === DEPRECATED_EQUITY_LIQUIDITY_CLI_FLAG
          ? "true"
          : undefined;
    expect(parseEquityLiquidityFacilityEnabled(both)).toBe(false);
    expect(parseEquityLiquidityFacilityEnabled(() => undefined)).toBeUndefined();
  });

  it("rejects non-boolean equity values with the flag name", () => {
    const read = () => "yes";
    expect(() => parseEquityLiquidityFacilityEnabled(read)).toThrow(
      "--equity-liquidity-facility must be true or false"
    );
  });

  it("carries the real-output shadow flag through config set and CLI args", () => {
    // Run identity: the sandbox gameConfig write and the simRuns/report
    // records flow from economicExperimentConfigSet, and worker emission
    // round-trips through the canonical CLI spelling.
    expect(economicExperimentConfigSet({ realOutputShadowEnabled: true })).toEqual({
      realOutputShadowEnabled: true,
    });
    expect(economicExperimentConfigSet({ realOutputShadowEnabled: false })).toEqual({
      realOutputShadowEnabled: false,
    });
    expect(economicExperimentCliArgs({ realOutputShadowEnabled: true })).toEqual([
      "--real-output-shadow=true",
    ]);
    expect(economicExperimentCliArgs({ realOutputShadowEnabled: false })).toEqual([
      "--real-output-shadow=false",
    ]);
  });

  it("leaves the real-output shadow flag unset unless explicitly requested", () => {
    expect(economicExperimentConfigSet({})).not.toHaveProperty("realOutputShadowEnabled");
    expect(economicExperimentCliArgs({})).not.toContain("--real-output-shadow=true");
  });

  it("guards the real-output shadow flag under preserve-live-config", () => {
    expect(isGameplayOverrideArg("--real-output-shadow=true")).toBe(true);
    expect(isGameplayOverrideArg("--real-output-shadow=false")).toBe(true);
    expect(isGameplayOverrideArg("--real-output-shadow")).toBe(false);
  });

  it("guards both equity spellings under preserve-live-config", () => {
    expect(isGameplayOverrideArg("--equity-liquidity-facility=true")).toBe(true);
    expect(isGameplayOverrideArg("--equity-liquidity-facility=false")).toBe(true);
    expect(isGameplayOverrideArg("--equity-liquidity=true")).toBe(true);
    expect(isGameplayOverrideArg("--equity-liquidity=false")).toBe(true);
    expect(isGameplayOverrideArg("--index-fund-bond-liquidity=true")).toBe(true);
    expect(isGameplayOverrideArg("--brand-loyalty")).toBe(true);
    expect(isGameplayOverrideArg("--seed=run1")).toBe(false);
    expect(isGameplayOverrideArg("--equity-liquidity-facility")).toBe(false);
  });
});
