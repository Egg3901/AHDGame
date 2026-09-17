import { describe, expect, it } from "vitest";
import {
  SIM_JOB_REQUESTED_CONFIG_KEYS,
  assertBaselineId,
  assertBaselineStampCompatible,
  assertPairedBaselineShape,
  assertPairId,
  assertRealOutputShadowPinnedPair,
  assertSafeToken,
  baselineDbNameFor,
  baselineProvenanceFlags,
  buildPairedBaselinePair,
  buildRealOutputShadowPinnedPair,
  buildRunWorldArgs,
  isBaselineDbName,
  normalizeSimCountries,
  normalizeSimJobRequestedConfig,
  pairedBaselineArmId,
  planBaselineCopy,
  planPairedBaselineRepair,
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
      // Pinned source (#1966): the worker executes the run from the pinned
      // worktree checkout, so arms pinned to different commits run different
      // code. Missing here would pass a code-mismatched pair as pinned and
      // drop the pin from the report's requestedConfig.
      "sourceWorktree",
      "sourceCommit",
      // Paired baseline (experiment-validity audit): the shared snapshot
      // both arms start from. Missing here would pass arms cloned at
      // different claim times as pinned and drop baseline identity from the
      // report's requestedConfig.
      "pairId",
      "baselineId",
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

  it("rejects any live clone on a pinned pair, even with matching flags", () => {
    // Experiment-validity audit: two arms that each clone live do so at
    // their own claim times, so identical flags prove nothing about the
    // starting world. Paired clone comparisons must share a baseline.
    const fresh = buildRealOutputShadowPinnedPair({});
    expect(() =>
      assertRealOutputShadowPinnedPair(fresh.control, {
        ...fresh.treatment,
        cloneFromLive: true,
      })
    ).toThrow("must copy the shared baseline");
    // The builder refuses to mint the invalid artifact in the first place.
    expect(() => buildRealOutputShadowPinnedPair({ cloneFromLive: true })).toThrow(
      "must not set cloneFromLive"
    );
    // ...while the assert still fails closed on hand-built clone docs (the
    // gate that protects pairs assembled outside the builder).
    const cloneControl = {
      preset: "p",
      turns: 4,
      seed: "s",
      realOutputShadowEnabled: false as const,
      cloneFromLive: true,
    };
    const cloneTreatment = { ...cloneControl, realOutputShadowEnabled: true as const };
    expect(() => assertRealOutputShadowPinnedPair(cloneControl, cloneTreatment)).toThrow(
      "must copy the shared baseline"
    );
    // Explicit-false on both arms is a fresh bootstrap on both sides: clean.
    const explicitFresh = buildRealOutputShadowPinnedPair({ cloneFromLive: false });
    expect(() =>
      assertRealOutputShadowPinnedPair(explicitFresh.control, explicitFresh.treatment)
    ).not.toThrow();
  });

  it("rejects pinned-source drift while accepting source-parity pairs", () => {
    // The worker executes the run from the pinned worktree checkout: arms
    // pinned to different commits run different code, so that pair is not a
    // clean comparison even with the shadow flag as the only other difference.
    const unpinned = buildRealOutputShadowPinnedPair({});
    expect(() =>
      assertRealOutputShadowPinnedPair(unpinned.control, {
        ...unpinned.treatment,
        sourceWorktree: "muse-1470",
        sourceCommit: "a".repeat(40),
      })
    ).toThrow('drifted on "sourceWorktree"');
    const pinned = buildRealOutputShadowPinnedPair({
      sourceWorktree: "muse-1470",
      sourceCommit: "a".repeat(40),
    });
    expect(pinned.control.sourceWorktree).toBe("muse-1470");
    expect(pinned.treatment.sourceCommit).toBe("a".repeat(40));
    expect(() =>
      assertRealOutputShadowPinnedPair(
        { preset: "p", turns: 4, seed: "s", ...pinned.control },
        { preset: "p", turns: 4, seed: "s", ...pinned.treatment }
      )
    ).not.toThrow();
    expect(() =>
      assertRealOutputShadowPinnedPair(pinned.control, {
        ...pinned.treatment,
        sourceCommit: "b".repeat(40),
      })
    ).toThrow('drifted on "sourceCommit"');
  });

  it("projects the pinned source through the authoritative requested config", () => {
    // collectExperimentReport.ts builds requestedConfig through this, so the
    // pin must survive the projection instead of being silently dropped.
    expect(
      normalizeSimJobRequestedConfig({
        preset: "p",
        sourceWorktree: "muse-1470",
        sourceCommit: "a".repeat(40),
      })
    ).toEqual({ preset: "p", sourceWorktree: "muse-1470", sourceCommit: "a".repeat(40) });
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

  it("builds a baselined pair sharing pair/baseline identity with strict shadow arms", () => {
    const { control, treatment } = buildPairedBaselinePair(
      { marketSystemMode: "capital", autonomyLevel: "v4" },
      { pairId: "rs1470-01", baselineId: "live-20260917" }
    );
    expect(control).toEqual({
      marketSystemMode: "capital",
      autonomyLevel: "v4",
      pairId: "rs1470-01",
      baselineId: "live-20260917",
      realOutputShadowEnabled: false,
    });
    expect(treatment).toEqual({ ...control, realOutputShadowEnabled: true });
    expect(() =>
      assertRealOutputShadowPinnedPair(
        { preset: "p", turns: 4, seed: "s", ...control },
        { preset: "p", turns: 4, seed: "s", ...treatment }
      )
    ).not.toThrow();
  });

  it("refuses to mint a baselined pair from a tainted base or tainted provenance", () => {
    const provenance = { pairId: "rs1470-01", baselineId: "live-20260917" };
    expect(() => buildPairedBaselinePair({ realOutputShadowEnabled: true }, provenance)).toThrow(
      "must not set realOutputShadowEnabled"
    );
    expect(() => buildPairedBaselinePair({ pairId: "x" }, provenance)).toThrow(
      "must not set pairId/baselineId"
    );
    expect(() => buildPairedBaselinePair({ baselineId: "x" }, provenance)).toThrow(
      "must not set pairId/baselineId"
    );
    expect(() => buildPairedBaselinePair({ cloneFromLive: true }, provenance)).toThrow(
      "must not set cloneFromLive"
    );
    expect(() => buildPairedBaselinePair({ cloneFromLive: false }, provenance)).toThrow(
      "must not set cloneFromLive"
    );
    expect(() => buildPairedBaselinePair({}, { pairId: "", baselineId: "b" })).toThrow(
      "pairId must match"
    );
    expect(() => buildPairedBaselinePair({}, { pairId: "p", baselineId: "a/b" })).toThrow(
      "baselineId must match"
    );
  });

  it("fails the pair assert when baseline starts differ", () => {
    const { control, treatment } = buildPairedBaselinePair(
      {},
      { pairId: "rs1470-01", baselineId: "live-20260917" }
    );
    // Same pair, different snapshots: not the same starting world.
    expect(() =>
      assertRealOutputShadowPinnedPair(control, { ...treatment, baselineId: "live-20260918" })
    ).toThrow('drifted on "baselineId"');
    // Same snapshot, different pair grouping: not the same comparison.
    expect(() =>
      assertRealOutputShadowPinnedPair(control, { ...treatment, pairId: "rs1470-02" })
    ).toThrow('drifted on "pairId"');
    // One arm carrying baseline identity the other lacks: mismatched start.
    expect(() =>
      assertRealOutputShadowPinnedPair(control, { ...treatment, baselineId: undefined as never })
    ).toThrow();
    const { control: freshControl, treatment: freshTreatment } = buildRealOutputShadowPinnedPair(
      {}
    );
    expect(() =>
      assertRealOutputShadowPinnedPair(freshControl, {
        ...freshTreatment,
        baselineId: "live-20260917",
      })
    ).toThrow();
    expect(() =>
      assertRealOutputShadowPinnedPair({ ...control, pairId: undefined as never }, treatment)
    ).toThrow();
  });

  it("fails the pair assert on malformed or half-present baseline provenance", () => {
    const good = buildPairedBaselinePair({}, { pairId: "rs1470-01", baselineId: "snap1" });
    for (const bad of ["", "a/b", 42, "x".repeat(65)]) {
      expect(() =>
        assertRealOutputShadowPinnedPair({ ...good.control, baselineId: bad }, good.treatment)
      ).toThrow("baselineId must match");
      expect(() =>
        assertRealOutputShadowPinnedPair(good.control, { ...good.treatment, pairId: bad })
      ).toThrow("pairId must match");
    }
    // Half-present: baseline without pair reads as a different (broken) start.
    expect(() =>
      assertRealOutputShadowPinnedPair(
        { realOutputShadowEnabled: false, baselineId: "snap1" },
        { realOutputShadowEnabled: true, baselineId: "snap1" }
      )
    ).toThrow("must both be set");
    expect(() =>
      assertRealOutputShadowPinnedPair(
        { realOutputShadowEnabled: false, pairId: "p" },
        { realOutputShadowEnabled: true }
      )
    ).toThrow("must both be set");
  });

  it("recovers partial pair creation without producing mismatched arms", () => {
    const pairId = "rs1470-01";
    const controlId = pairedBaselineArmId(pairId, "control");
    const treatmentId = pairedBaselineArmId(pairId, "treatment");
    expect(controlId).toBe("rs1470-01-control");
    expect(treatmentId).toBe("rs1470-01-treatment");
    // Nothing created yet: both arms missing.
    expect(planPairedBaselineRepair([], pairId)).toEqual(["control", "treatment"]);
    // Crash between the two inserts: only the missing arm is (re-)inserted,
    // upserted by deterministic _id so a retry converges.
    expect(planPairedBaselineRepair([{ _id: controlId }], pairId)).toEqual(["treatment"]);
    expect(planPairedBaselineRepair([treatmentId], pairId)).toEqual(["control"]);
    // Completed creation re-runs to nothing; foreign pairs are ignored.
    expect(planPairedBaselineRepair([{ _id: controlId }, { _id: treatmentId }], pairId)).toEqual(
      []
    );
    expect(
      planPairedBaselineRepair(
        [{ _id: controlId }, { _id: treatmentId }, { _id: "rs1470-02-control" }],
        pairId
      )
    ).toEqual([]);
    expect(() => pairedBaselineArmId("", "control")).toThrow("pairId must match");
    expect(() => planPairedBaselineRepair([], "")).toThrow("pairId must match");
  });

  it("derives the baseline snapshot db and guards the claim-time copy", () => {
    expect(baselineDbNameFor("live-20260917")).toBe("ahd_sim_baseline_live-20260917");
    expect(isBaselineDbName("ahd_sim_baseline_x")).toBe(true);
    expect(isBaselineDbName("ahd_sim_s1")).toBe(false);
    expect(() => baselineDbNameFor("a/b")).toThrow("baselineId must match");
    expect(() => baselineDbNameFor("x".repeat(48))).toThrow("too long");
    // Happy path: baseline snapshot -> arm db.
    expect(planBaselineCopy({ pairId: "p", baselineId: "snap1", dbName: "ahd_sim_arm1" })).toEqual({
      sourceDb: "ahd_sim_baseline_snap1",
      destDb: "ahd_sim_arm1",
    });
    // No provenance, no copy.
    expect(() => planBaselineCopy({ dbName: "ahd_sim_arm1" })).toThrow("no paired-baseline");
    // Never run turns against the immutable snapshot itself.
    expect(() =>
      planBaselineCopy({ pairId: "p", baselineId: "snap1", dbName: "ahd_sim_baseline_snap1" })
    ).toThrow("immutable copy sources");
    // Half-present provenance and unsafe db names fail closed.
    expect(() => planBaselineCopy({ baselineId: "snap1", dbName: "ahd_sim_arm1" })).toThrow(
      "must both be set"
    );
    expect(() => planBaselineCopy({ pairId: "p", baselineId: "snap1", dbName: "a/b" })).toThrow(
      "dbName must match"
    );
  });

  it("projects baseline identity through the authoritative requested config", () => {
    // collectExperimentReport.ts builds requestedConfig through this, so the
    // baseline must survive the projection for the report assert to see it.
    expect(
      normalizeSimJobRequestedConfig({
        preset: "p",
        turns: 4,
        seed: "s",
        pairId: "rs1470-01",
        baselineId: "live-20260917",
        realOutputShadowEnabled: true,
      })
    ).toEqual({
      preset: "p",
      turns: 4,
      seed: "s",
      pairId: "rs1470-01",
      baselineId: "live-20260917",
      realOutputShadowEnabled: true,
    });
    // Older jobs without baseline identity project exactly as before.
    expect(normalizeSimJobRequestedConfig({ preset: "p", turns: 4, seed: "s" })).toEqual({
      preset: "p",
      turns: 4,
      seed: "s",
    });
    // ...and the report-shaped maps verify end to end through the assert.
    const { control, treatment } = buildPairedBaselinePair(
      {},
      { pairId: "rs1470-01", baselineId: "live-20260917" }
    );
    const reportedControl = normalizeSimJobRequestedConfig({
      preset: "p",
      turns: 4,
      seed: "s",
      ...control,
    });
    const reportedTreatment = normalizeSimJobRequestedConfig({
      preset: "p",
      turns: 4,
      seed: "s",
      ...treatment,
    });
    expect(() =>
      assertRealOutputShadowPinnedPair(reportedControl, reportedTreatment)
    ).not.toThrow();
    expect(() =>
      assertRealOutputShadowPinnedPair(reportedControl, {
        ...reportedTreatment,
        baselineId: "live-20260918",
      })
    ).toThrow('drifted on "baselineId"');
  });

  it("keeps strict false/true treatment identity on baselined pairs", () => {
    const { control, treatment } = buildPairedBaselinePair({}, { pairId: "p", baselineId: "b" });
    expect(() =>
      assertRealOutputShadowPinnedPair(
        { ...control, realOutputShadowEnabled: undefined as never },
        treatment
      )
    ).toThrow("control must carry");
    expect(() => assertRealOutputShadowPinnedPair(control, control)).toThrow(
      "treatment must carry"
    );
    expect(() => assertRealOutputShadowPinnedPair(treatment, treatment)).toThrow(
      "control must carry"
    );
  });

  it("emits baseline provenance argv only for baselined jobs", () => {
    expect(baselineProvenanceFlags({})).toEqual([]);
    const { control } = buildPairedBaselinePair({}, { pairId: "p", baselineId: "b" });
    expect(baselineProvenanceFlags(control)).toEqual(["--pair-id=p", "--baseline-id=b"]);
    expect(() => baselineProvenanceFlags({ pairId: "p" })).toThrow("must both be set");
    // The turn-args builder never emits provenance itself: planRunWorldSpawn
    // (simSource.ts) appends baselineProvenanceFlags separately.
    expect(buildRunWorldArgs(control).some((a) => a.includes("pair-id"))).toBe(false);
    expect(buildRunWorldArgs(control).some((a) => a.includes("baseline"))).toBe(false);
  });

  it("refuses to re-stamp a mutated baseline snapshot", () => {
    // First stamp and identical re-stamp pass.
    expect(() =>
      assertBaselineStampCompatible(null, { baselineId: "b", sourceTurn: 10, docCount: 5 })
    ).not.toThrow();
    expect(() =>
      assertBaselineStampCompatible(
        { baselineId: "b", sourceTurn: 10, docCount: 5 },
        { baselineId: "b", sourceTurn: 10, docCount: 5 }
      )
    ).not.toThrow();
    // A turn advance or doc change means something ran against the snapshot.
    expect(() =>
      assertBaselineStampCompatible(
        { baselineId: "b", sourceTurn: 10, docCount: 5 },
        { baselineId: "b", sourceTurn: 11, docCount: 5 }
      )
    ).toThrow("refusing to re-stamp a mutated snapshot");
    expect(() =>
      assertBaselineStampCompatible(
        { baselineId: "b", sourceTurn: 10, docCount: 5 },
        { baselineId: "b", sourceTurn: 10, docCount: 6 }
      )
    ).toThrow("refusing to re-stamp a mutated snapshot");
  });

  it("validates pair and baseline ids strictly", () => {
    expect(assertPairId("rs1470-01")).toBe("rs1470-01");
    expect(assertBaselineId("live-20260917")).toBe("live-20260917");
    expect(assertPairedBaselineShape({})).toBeNull();
    expect(assertPairedBaselineShape({ pairId: "p", baselineId: "b" })).toEqual({
      pairId: "p",
      baselineId: "b",
    });
    for (const bad of [undefined, null, "", 42, "a/b", "x".repeat(65)]) {
      if (bad === undefined) continue;
      expect(() => assertPairId(bad)).toThrow("pairId must match");
      expect(() => assertBaselineId(bad)).toThrow("baselineId must match");
    }
  });
});
