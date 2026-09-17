import { describe, expect, it } from "vitest";
import {
  SIM_JOB_REQUESTED_CONFIG_KEYS,
  assertRealOutputShadowPinnedPair,
  assertSafeToken,
  buildRealOutputShadowPinnedPair,
  buildRunWorldArgs,
  type SimJobExperimentFields,
} from "./simJobArgs";
import { REAL_OUTPUT_SHADOW_CLI_FLAG } from "@/lib/economy/realOutputShadow";

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

  it("carries an explicit true/false real-output shadow override with the canonical flag", () => {
    expect(REAL_OUTPUT_SHADOW_CLI_FLAG).toBe("real-output-shadow");
    expect(buildRunWorldArgs({ realOutputShadowEnabled: true })).toContain(
      "--real-output-shadow=true"
    );
    expect(buildRunWorldArgs({ realOutputShadowEnabled: false })).toContain(
      "--real-output-shadow=false"
    );
  });

  it("omits the real-output shadow flag when the job leaves it unset", () => {
    expect(buildRunWorldArgs({}).some((a) => a.includes("real-output-shadow"))).toBe(false);
  });

  it("never implies the shadow flag from --all-feature-flags", () => {
    expect(buildRunWorldArgs({ allFeatureFlags: true })).toEqual(["--all-feature-flags"]);
  });

  it("rejects non-boolean shadow values instead of stringifying them", () => {
    const job = { realOutputShadowEnabled: "true" } as unknown as SimJobExperimentFields;
    expect(() => buildRunWorldArgs(job)).toThrow("realOutputShadowEnabled must be boolean");
  });

  it("builds a pinned pair differing only in the shadow flag", () => {
    const base: SimJobExperimentFields = {
      marketSystemMode: "capital",
      autonomyLevel: "v4",
    };
    const { control, treatment } = buildRealOutputShadowPinnedPair(base);
    expect(control).toEqual({ ...base, realOutputShadowEnabled: false });
    expect(treatment).toEqual({ ...base, realOutputShadowEnabled: true });
    expect(() => buildRealOutputShadowPinnedPair({ realOutputShadowEnabled: true })).toThrow(
      "must not set realOutputShadowEnabled"
    );
  });

  it("accepts a built pair as pinned, including preset/turns/seed identity", () => {
    const { control, treatment } = buildRealOutputShadowPinnedPair({
      marketSystemMode: "capital",
    });
    expect(() =>
      assertRealOutputShadowPinnedPair(
        { preset: "default", turns: 48, seed: "s1", ...control },
        { preset: "default", turns: 48, seed: "s1", ...treatment }
      )
    ).not.toThrow();
  });

  it("rejects an unpinned pair: seed drift, field drift, or implicit arms", () => {
    const { control, treatment } = buildRealOutputShadowPinnedPair({});
    expect(() =>
      assertRealOutputShadowPinnedPair({ seed: "s1", ...control }, { seed: "s2", ...treatment })
    ).toThrow('drifted on "seed"');
    expect(() =>
      assertRealOutputShadowPinnedPair(control, {
        ...treatment,
        marketSystemMode: "capital",
      })
    ).toThrow('drifted on "marketSystemMode"');
    expect(() => assertRealOutputShadowPinnedPair({}, treatment)).toThrow("control must carry");
    expect(() => assertRealOutputShadowPinnedPair(control, control)).toThrow(
      "treatment must carry"
    );
  });

  it("emits argv for a pinned pair that differs only in the shadow flag", () => {
    const { control, treatment } = buildRealOutputShadowPinnedPair({
      marketSystemMode: "capital",
      autonomyLevel: "v4",
    });
    const controlArgs = buildRunWorldArgs(control);
    const treatmentArgs = buildRunWorldArgs(treatment);
    expect(controlArgs).toContain("--real-output-shadow=false");
    expect(treatmentArgs).toContain("--real-output-shadow=true");
    expect(treatmentArgs.filter((a) => a !== "--real-output-shadow=true")).toEqual(
      controlArgs.filter((a) => a !== "--real-output-shadow=false")
    );
  });

  it("keeps the report requestedConfig keys covering every emitted experiment field", () => {
    // Run identity: collectExperimentReport.ts filters the job doc through
    // this list, so a queueable field missing here would be silently dropped
    // from the report while still affecting the run.
    const keys = [...SIM_JOB_REQUESTED_CONFIG_KEYS];
    for (const field of [
      "marketSystemMode",
      "labourSystemMode",
      "freightSettlementMode",
      "canonicalFreightBillingEnabled",
      "shortageResponsiveSourcingEnabled",
      "indexFundBondLiquidityEnabled",
      "equityLiquidityFacilityEnabled",
      "nppMarketCoverageEnabled",
      "nppFragileMarketSupplyEnabled",
      "realOutputShadowEnabled",
      "allFeatureFlags",
      "autonomyLevel",
    ]) {
      expect(keys).toContain(field);
    }
  });
});
