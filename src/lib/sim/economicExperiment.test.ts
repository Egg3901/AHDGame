import { describe, expect, it } from "vitest";
import {
  allFeatureFlagsGameStateSet,
  DEPRECATED_EQUITY_LIQUIDITY_CLI_FLAG,
  economicExperimentCliArgs,
  economicExperimentConfigSet,
  EQUITY_LIQUIDITY_FACILITY_CLI_FLAG,
  FRONTIER_ENTRY_SIM_CLI_FLAG,
  frontierEntryExperimentCliArgs,
  isGameplayOverrideArg,
  parseEquityLiquidityFacilityEnabled,
  parseFrontierEntryExperimentArg,
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
        sovereignIssuanceConsolidationEnabled: false,
        domesticSovereignBondCoverageEnabled: false,
        equityLiquidityFacilityEnabled: false,
        nppMarketCoverageEnabled: false,
        nppFragileMarketSupplyEnabled: false,
      })
    ).toEqual({
      freightSettlementMode: "shadow",
      canonicalFreightBillingEnabled: false,
      shortageResponsiveSourcingEnabled: false,
      indexFundBondLiquidityEnabled: false,
      sovereignIssuanceConsolidationEnabled: false,
      domesticSovereignBondCoverageEnabled: false,
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
        sovereignIssuanceConsolidationEnabled: true,
        domesticSovereignBondCoverageEnabled: true,
        equityLiquidityFacilityEnabled: false,
        nppMarketCoverageEnabled: false,
        nppFragileMarketSupplyEnabled: false,
      })
    ).toEqual([
      "--freight-settlement=shadow",
      "--canonical-freight-billing=false",
      "--shortage-responsive-sourcing=false",
      "--index-fund-bond-liquidity=false",
      "--sovereign-issuance-consolidation=true",
      "--domestic-sovereign-bond-coverage=true",
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

  it("guards both equity spellings under preserve-live-config", () => {
    expect(isGameplayOverrideArg("--equity-liquidity-facility=true")).toBe(true);
    expect(isGameplayOverrideArg("--equity-liquidity-facility=false")).toBe(true);
    expect(isGameplayOverrideArg("--equity-liquidity=true")).toBe(true);
    expect(isGameplayOverrideArg("--equity-liquidity=false")).toBe(true);
    expect(isGameplayOverrideArg("--index-fund-bond-liquidity=true")).toBe(true);
    expect(isGameplayOverrideArg("--sovereign-issuance-consolidation=true")).toBe(true);
    expect(isGameplayOverrideArg("--domestic-sovereign-bond-coverage=true")).toBe(true);
    expect(isGameplayOverrideArg("--brand-loyalty")).toBe(true);
    expect(isGameplayOverrideArg("--seed=run1")).toBe(false);
    expect(isGameplayOverrideArg("--equity-liquidity-facility")).toBe(false);
  });
});

describe("frontier-entry experiment sim wiring (#991)", () => {
  it("preserves explicit true and false end to end through one spelling", () => {
    expect(frontierEntryExperimentCliArgs(true)).toEqual([`--${FRONTIER_ENTRY_SIM_CLI_FLAG}=true`]);
    expect(frontierEntryExperimentCliArgs(false)).toEqual([
      `--${FRONTIER_ENTRY_SIM_CLI_FLAG}=false`,
    ]);
    expect(frontierEntryExperimentCliArgs(undefined)).toEqual([]);
    // The worker emits with the helper and runWorld parses with the helper:
    // both values round-trip, so the off control is never dropped to absent.
    for (const value of [true, false] as const) {
      const [emitted] = frontierEntryExperimentCliArgs(value);
      const raw = emitted.slice(`--${FRONTIER_ENTRY_SIM_CLI_FLAG}=`.length);
      expect(parseFrontierEntryExperimentArg(raw)).toBe(value);
    }
  });

  it("parses only explicit frontier booleans", () => {
    expect(parseFrontierEntryExperimentArg(undefined)).toBeUndefined();
    expect(parseFrontierEntryExperimentArg("true")).toBe(true);
    expect(parseFrontierEntryExperimentArg("false")).toBe(false);
    expect(() => parseFrontierEntryExperimentArg("yes")).toThrow("must be true or false");
  });

  it("guards the frontier flag under preserve-live-config", () => {
    expect(isGameplayOverrideArg("--frontier-entry-experiment=true")).toBe(true);
    expect(isGameplayOverrideArg("--frontier-entry-experiment=false")).toBe(true);
    expect(isGameplayOverrideArg("--frontier-entry-experiment")).toBe(false);
  });

  it("keeps the experimental gate out of the all-feature-flags sweep", () => {
    const set = allFeatureFlagsGameStateSet({
      forexEnabled: true,
      autoSectorSeedEnabled: false,
      nppAutonomyLevel: "v4",
      frontierEntryExperimentEnabled: false,
    });
    expect(set).toEqual({ forexEnabled: true, autoSectorSeedEnabled: true });
    expect(set).not.toHaveProperty("frontierEntryExperimentEnabled");
    expect(set).not.toHaveProperty("nppAutonomyLevel");
  });

  it("builds off/on trial arms that differ only in the frontier gate", () => {
    // Controlled 48-turn evaluation identity: identical preset/seed/turn
    // count, one field apart. The queue payloads below mirror what
    // sim_run_world enqueues for each arm.
    const base = { preset: "2019-default", seed: "frontier-991", turns: 48 };
    const off = { ...base, frontierEntryExperimentEnabled: false };
    const on = { ...base, frontierEntryExperimentEnabled: true };
    const { frontierEntryExperimentEnabled: _offGate, ...offRest } = off;
    const { frontierEntryExperimentEnabled: _onGate, ...onRest } = on;
    expect(onRest).toEqual(offRest);
    expect(off.frontierEntryExperimentEnabled).toBe(false);
    expect(on.frontierEntryExperimentEnabled).toBe(true);
    // Each arm survives the worker emission step distinctly.
    expect(frontierEntryExperimentCliArgs(off.frontierEntryExperimentEnabled)).toEqual([
      `--${FRONTIER_ENTRY_SIM_CLI_FLAG}=false`,
    ]);
    expect(frontierEntryExperimentCliArgs(on.frontierEntryExperimentEnabled)).toEqual([
      `--${FRONTIER_ENTRY_SIM_CLI_FLAG}=true`,
    ]);
  });
});
