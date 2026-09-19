import { describe, expect, it } from "vitest";
import {
  assertSafeToken,
  buildRunWorldArgs,
  parseActorsField,
  type SimJobExperimentFields,
} from "./simJobArgs";

describe("sim worker runWorld argument emission", () => {
  it("carries an explicit true equity override with the canonical flag", () => {
    const job: SimJobExperimentFields = { equityLiquidityFacilityEnabled: true };
    expect(buildRunWorldArgs(job)).toContain("--equity-liquidity-facility=true");
  });

  it("carries an explicit false equity override without silent fallback", () => {
    const job: SimJobExperimentFields = { equityLiquidityFacilityEnabled: false };
    expect(buildRunWorldArgs(job)).toContain("--equity-liquidity-facility=false");
  });

  it("omits the equity flag when the job leaves it unset", () => {
    const args = buildRunWorldArgs({});
    expect(args.some((a) => a.includes("equity-liquidity"))).toBe(false);
  });

  it("emits every experiment override end to end", () => {
    const job: SimJobExperimentFields = {
      marketSystemMode: "capital",
      labourSystemMode: "full",
      freightSettlementMode: "active",
      canonicalFreightBillingEnabled: true,
      shortageResponsiveSourcingEnabled: false,
      indexFundBondLiquidityEnabled: true,
      equityLiquidityFacilityEnabled: true,
      nppMarketCoverageEnabled: false,
      nppFragileMarketSupplyEnabled: true,
      allFeatureFlags: true,
      autonomyLevel: "v4",
      mode: "full",
      countries: "US,UK",
    };
    expect(buildRunWorldArgs(job)).toEqual([
      "--market-mode=capital",
      "--labour-mode=full",
      "--freight-settlement=active",
      "--canonical-freight-billing=true",
      "--shortage-responsive-sourcing=false",
      "--index-fund-bond-liquidity=true",
      "--equity-liquidity-facility=true",
      "--npp-market-coverage=false",
      "--npp-fragile-market-supply=true",
      "--all-feature-flags",
      "--autonomy=v4",
      "--mode=full",
      "--countries=US,UK",
    ]);
  });

  it("rejects non-boolean equity values instead of stringifying them", () => {
    const job = { equityLiquidityFacilityEnabled: "true" } as unknown as SimJobExperimentFields;
    expect(() => buildRunWorldArgs(job)).toThrow("equityLiquidityFacilityEnabled must be boolean");
  });

  it("carries the frontier-entry gate for both trial arms without silent fallback (#991)", () => {
    expect(buildRunWorldArgs({ frontierEntryExperimentEnabled: true })).toContain(
      "--frontier-entry-experiment=true"
    );
    expect(buildRunWorldArgs({ frontierEntryExperimentEnabled: false })).toContain(
      "--frontier-entry-experiment=false"
    );
  });

  it("omits the frontier-entry flag when the job leaves it unset (#991)", () => {
    const args = buildRunWorldArgs({});
    expect(args.some((a) => a.includes("frontier-entry-experiment"))).toBe(false);
  });

  it("rejects non-boolean frontier-entry values instead of stringifying them (#991)", () => {
    const job = {
      frontierEntryExperimentEnabled: "true",
    } as unknown as SimJobExperimentFields;
    expect(() => buildRunWorldArgs(job)).toThrow("frontierEntryExperimentEnabled must be boolean");
  });

  it("rejects unknown tiers and unsafe country tokens", () => {
    expect(() => buildRunWorldArgs({ marketSystemMode: "nope" })).toThrow(
      'invalid marketSystemMode "nope"'
    );
    expect(() => buildRunWorldArgs({ countries: "US;rm" })).toThrow(
      'Job field "countries[]" failed validation'
    );
  });

  it("validates safe tokens", () => {
    expect(assertSafeToken("run-1_seed", "_id")).toBe("run-1_seed");
    expect(() => assertSafeToken("a/b", "_id")).toThrow('Job field "_id" failed validation');
  });

  it("omits the actors flag for pre-mode jobs (backward-compatible pure NPP)", () => {
    expect(buildRunWorldArgs({})).not.toContain("--actors=synthetic");
    expect(buildRunWorldArgs({}).some((a) => a.startsWith("--actors="))).toBe(false);
  });

  it("emits the actors flag for explicit synthetic jobs", () => {
    expect(buildRunWorldArgs({ actors: "synthetic" })).toContain("--actors=synthetic");
    expect(buildRunWorldArgs({ actors: "pure-npp" })).toContain("--actors=pure-npp");
  });

  it("rejects unknown actors modes instead of running the wrong population", () => {
    expect(() => buildRunWorldArgs({ actors: "all" })).toThrow('invalid actors "all"');
  });
});

describe("parseActorsField", () => {
  it("returns undefined when omitted (harness default)", () => {
    expect(parseActorsField(undefined)).toBeUndefined();
  });

  it("accepts both known modes", () => {
    expect(parseActorsField("pure-npp")).toBe("pure-npp");
    expect(parseActorsField("synthetic")).toBe("synthetic");
  });

  it("throws on typos and non-strings", () => {
    expect(() => parseActorsField("synthetc")).toThrow('invalid actors "synthetc"');
    expect(() => parseActorsField(42)).toThrow("invalid actors");
  });
});
