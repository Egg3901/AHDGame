import { describe, expect, it } from "vitest";
import {
  SIM_JOB_REQUESTED_CONFIG_KEYS,
  assertRealOutputShadowPinnedPair,
  assertSafeToken,
  buildRealOutputShadowPinnedPair,
  buildRunWorldArgs,
  normalizeSimCountries,
  normalizeSimJobRequestedConfig,
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
      "mode",
      "countries",
      // Clone source: worker.ts clones the live world then passes
      // --clone-mode, so a clone arm and a fresh arm start from different
      // initial state. Missing here would hide that behind identical reports.
      "cloneFromLive",
    ]) {
      expect(keys).toContain(field);
    }
    // Scheduling metadata is not run identity: startPolicy only gates claim
    // admission (claimWindow.ts), never reaches runWorld argv or the sandbox
    // DB, so it must never count as pair drift.
    expect(keys).not.toContain("startPolicy");
  });

  it("normalizes countries the way runWorld sees them: trim, uppercase, order-insensitive", () => {
    expect(normalizeSimCountries("us, UK ")).toBe("UK,US");
    expect(normalizeSimCountries("UK,US")).toBe(normalizeSimCountries("uk,us"));
    expect(normalizeSimCountries("  ")).toBeUndefined();
    expect(normalizeSimCountries(undefined)).toBeUndefined();
  });

  it("projects the authoritative requested config with normalized countries", () => {
    expect(
      normalizeSimJobRequestedConfig({
        _id: "run1",
        dbName: "ahd_sim_s1",
        preset: "default",
        turns: 48,
        seed: "s1",
        mode: "elections-only",
        countries: "uk, us",
        realOutputShadowEnabled: true,
      })
    ).toEqual({
      preset: "default",
      turns: 48,
      seed: "s1",
      mode: "elections-only",
      countries: "UK,US",
      realOutputShadowEnabled: true,
    });
  });

  it("keeps older jobs without run-profile fields projecting exactly as before", () => {
    expect(normalizeSimJobRequestedConfig({ preset: "default", turns: 48, seed: "s1" })).toEqual({
      preset: "default",
      turns: 48,
      seed: "s1",
    });
    // Whitespace-only scope emits no flag, so it reports as unset, not empty.
    expect(normalizeSimJobRequestedConfig({ preset: "default", countries: "  " })).toEqual({
      preset: "default",
    });
  });

  it("treats spelling-only countries differences as the same run, real drift as drift", () => {
    const { control, treatment } = buildRealOutputShadowPinnedPair({
      mode: "elections-only",
      countries: "US,UK",
    });
    expect(() =>
      assertRealOutputShadowPinnedPair(control, { ...treatment, countries: "uk, us" })
    ).not.toThrow();
    expect(() => assertRealOutputShadowPinnedPair(control, { ...treatment, mode: "full" })).toThrow(
      'drifted on "mode"'
    );
    expect(() =>
      assertRealOutputShadowPinnedPair(control, { ...treatment, countries: "US,UK,DE" })
    ).toThrow('drifted on "countries"');
    expect(() =>
      assertRealOutputShadowPinnedPair(control, { ...treatment, countries: "  " })
    ).toThrow('drifted on "countries"');
  });

  it("rejects clone-source drift while accepting clone-parity pairs", () => {
    // A clone arm starts from live state, a fresh arm from preset bootstrap:
    // same shadow flag or not, that pair is not a clean comparison.
    const fresh = buildRealOutputShadowPinnedPair({});
    expect(() =>
      assertRealOutputShadowPinnedPair(fresh.control, {
        ...fresh.treatment,
        cloneFromLive: true,
      })
    ).toThrow('drifted on "cloneFromLive"');
    // Clone parity on both arms is a clean comparison (both start from the
    // same live source); the builder carries the base through its spread.
    const cloneBase = buildRealOutputShadowPinnedPair({ cloneFromLive: true });
    expect(cloneBase.control.cloneFromLive).toBe(true);
    expect(cloneBase.treatment.cloneFromLive).toBe(true);
    expect(() =>
      assertRealOutputShadowPinnedPair(
        { preset: "p", turns: 4, seed: "s", ...cloneBase.control },
        { preset: "p", turns: 4, seed: "s", ...cloneBase.treatment }
      )
    ).not.toThrow();
  });

  it("leaves --clone-mode to the worker: the args builder never emits it", () => {
    // worker.ts owns the clone step (cloneWorld.ts) and appends --clone-mode
    // itself; buildRunWorldArgs carrying cloneFromLive would double-emit or
    // silently drop it. The pinned assert above is what catches the drift.
    expect(buildRunWorldArgs({ cloneFromLive: true }).some((a) => a.includes("clone"))).toBe(false);
    expect(buildRunWorldArgs({ cloneFromLive: false }).some((a) => a.includes("clone"))).toBe(
      false
    );
  });

  it("drops scheduling metadata from run identity without breaking old reports", () => {
    // startPolicy gates claim admission only; a control claimed immediately
    // and a treatment claimed in-window ran identically.
    expect(normalizeSimJobRequestedConfig({ preset: "p", startPolicy: "immediate" })).toEqual({
      preset: "p",
    });
    const { control, treatment } = buildRealOutputShadowPinnedPair({});
    expect(() =>
      assertRealOutputShadowPinnedPair(
        { ...control, startPolicy: "immediate" },
        { ...treatment, startPolicy: "window" }
      )
    ).not.toThrow();
    // Old reports recorded startPolicy in requestedConfig: they still
    // validate against new jobs that no longer carry it.
    expect(() =>
      assertRealOutputShadowPinnedPair(
        { realOutputShadowEnabled: false, startPolicy: "immediate" },
        { realOutputShadowEnabled: true }
      )
    ).not.toThrow();
  });

  it("keeps older jobs without a clone source projecting exactly as before", () => {
    expect(normalizeSimJobRequestedConfig({ preset: "default", turns: 48, seed: "s1" })).toEqual({
      preset: "default",
      turns: 48,
      seed: "s1",
    });
    expect(
      normalizeSimJobRequestedConfig({
        preset: "default",
        turns: 48,
        seed: "s1",
        cloneFromLive: true,
      })
    ).toEqual({ preset: "default", turns: 48, seed: "s1", cloneFromLive: true });
  });

  it("emits argv for a mode- and country-scoped pinned pair differing only in the shadow flag", () => {
    const { control, treatment } = buildRealOutputShadowPinnedPair({
      mode: "elections-only",
      countries: "US,UK",
    });
    const controlArgs = buildRunWorldArgs(control);
    const treatmentArgs = buildRunWorldArgs(treatment);
    expect(controlArgs).toContain("--mode=elections-only");
    expect(controlArgs).toContain("--countries=US,UK");
    expect(treatmentArgs.filter((a) => a !== "--real-output-shadow=true")).toEqual(
      controlArgs.filter((a) => a !== "--real-output-shadow=false")
    );
  });
});
