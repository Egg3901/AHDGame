import { describe, expect, it } from "vitest";
import {
  resetSeedComplete,
  resetSelectionPreflight,
  resetSystemVersionsFrom,
  resetSystemVersionsForCountry,
  mergeResetReceiptCountries,
  resetSystemSelectionsFrom,
  resetVersionSelectionEligibility,
  resolveResetSystemVersion,
  RESET_V2_SEED_REVISION,
} from "./rules";

describe("reset-era system versions", () => {
  const ready = { metrics: true, legislation: true, cabinet: true };
  const staged = { metrics: false, legislation: false, cabinet: false };
  const seeded = {
    resetWorldId: "world-a",
    resetVersionSeeds: Object.fromEntries(
      ["metrics", "legislation", "cabinet"].map((system) => [
        system,
        {
          worldId: "world-a",
          revision: RESET_V2_SEED_REVISION[system as "metrics" | "legislation" | "cabinet"],
          sourceTurn: 42,
          completedAt: "2026-09-29T00:00:00.000Z",
          verificationHash: `verified-${system}`,
        },
      ])
    ) as never,
  };

  it("keeps missing and unknown values on v1", () => {
    expect(resetSystemVersionsFrom(null, ready)).toEqual({
      metrics: "v1",
      legislation: "v1",
      cabinet: "v1",
    });
    expect(resolveResetSystemVersion("v3", true)).toBe("v1");
  });

  it("resolves the separate versions only when Metrics v2 is active", () => {
    expect(
      resetSystemVersionsFrom(
        {
          ...seeded,
          metricsSystemVersion: "v2",
          legislationSystemVersion: "v1",
          cabinetSystemVersion: "v2",
        },
        ready
      )
    ).toEqual({ metrics: "v2", legislation: "v1", cabinet: "v2" });
    expect(
      resetSystemVersionsFrom(
        { ...seeded, legislationSystemVersion: "v2", cabinetSystemVersion: "v2" },
        ready
      )
    ).toEqual({ metrics: "v1", legislation: "v1", cabinet: "v1" });
  });

  it("fails closed if a stored v2 value is not released", () => {
    expect(
      resetSystemVersionsFrom(
        {
          ...seeded,
          metricsSystemVersion: "v2",
          legislationSystemVersion: "v2",
          cabinetSystemVersion: "v2",
        },
        staged
      )
    ).toEqual({ metrics: "v1", legislation: "v1", cabinet: "v1" });
  });

  it("requires Metrics v2 first and makes a downgrade order explicit", () => {
    expect(resetVersionSelectionEligibility(null, "legislation", "v2", ready)).toEqual({
      allowed: false,
      reason: "metrics_required",
    });
    expect(
      resetVersionSelectionEligibility(
        { resetSystemSelections: { metrics: "v2" } },
        "legislation",
        "v2",
        ready
      )
    ).toEqual({ allowed: true });
    expect(
      resetVersionSelectionEligibility(
        { resetSystemSelections: { metrics: "v2", cabinet: "v2" } },
        "metrics",
        "v1",
        ready
      )
    ).toEqual({ allowed: false, reason: "dependent_v2" });
    expect(resetVersionSelectionEligibility(null, "metrics", "v2", staged)).toEqual({
      allowed: false,
      reason: "unavailable",
    });
  });

  it("requires a matching opening-seed receipt for the current world and revision", () => {
    expect(resetSystemVersionsFrom({ metricsSystemVersion: "v2" }, ready).metrics).toBe("v1");
    expect(resetSeedComplete(seeded, "metrics")).toBe(true);
    expect(resetSeedComplete({ ...seeded, resetWorldId: "world-b" }, "metrics")).toBe(false);
  });

  it("keeps other countries on v1 even when all global selectors are v2", () => {
    const state = {
      ...seeded,
      metricsSystemVersion: "v2",
      legislationSystemVersion: "v2",
      cabinetSystemVersion: "v2",
    };
    for (const country of ["US", "UK", "JP"]) {
      expect(resetSystemVersionsForCountry(state, ready, country)).toEqual({
        metrics: "v2",
        legislation: "v2",
        cabinet: "v2",
      });
    }
    for (const country of ["DE", "CN", "IE", "BR", "RU"]) {
      expect(resetSystemVersionsForCountry(state, ready, country)).toEqual({
        metrics: "v1",
        legislation: "v1",
        cabinet: "v1",
      });
    }
  });

  it("preserves legacy receipt coverage while adding promoted countries", () => {
    expect(mergeResetReceiptCountries(undefined, ["SCO"])).toEqual(["JP", "SCO", "UK", "US"]);
    expect(mergeResetReceiptCountries(["SCO"], ["IE"])).toEqual(["IE", "JP", "SCO", "UK", "US"]);
  });

  it("separates next-reset selections from effective live versions", () => {
    const state = {
      resetSystemSelections: { metrics: "v2" as const, legislation: "v2" as const },
    };
    expect(resetSystemSelectionsFrom(state)).toEqual({
      metrics: "v2",
      legislation: "v2",
      cabinet: "v1",
    });
    expect(resetSystemVersionsFrom(state, ready)).toEqual({
      metrics: "v1",
      legislation: "v1",
      cabinet: "v1",
    });
    expect(resetVersionSelectionEligibility(state, "metrics", "v1", ready)).toEqual({
      allowed: false,
      reason: "dependent_v2",
    });
    expect(
      resetVersionSelectionEligibility(
        { metricsSystemVersion: "v2", cabinetSystemVersion: "v2" },
        "metrics",
        "v1",
        ready
      )
    ).toEqual({ allowed: false, reason: "dependent_v2" });
    expect(resetVersionSelectionEligibility(null, "cabinet", "v2", ready)).toEqual({
      allowed: false,
      reason: "metrics_required",
    });
  });

  it("preflights staged v2 against era, anchor date, and runtime readiness", () => {
    const state = { resetSystemSelections: { metrics: "v2" as const } };
    expect(resetSelectionPreflight(null, "2019-default", false, staged)).toEqual({ allowed: true });
    expect(resetSelectionPreflight(state, "2019-default", true, ready)).toEqual({
      allowed: false,
      reason: "Reset v2 requires the 1991-default opening date",
    });
    expect(resetSelectionPreflight(state, "1991-default", false, ready).allowed).toBe(false);
    expect(resetSelectionPreflight(state, "1991-default", true, staged)).toEqual({
      allowed: false,
      reason: "Reset v2 systems are not ready: metrics",
    });
    expect(resetSelectionPreflight(state, "1991-default", true, ready)).toEqual({ allowed: true });
  });

  it("rejects an inconsistent stored selection rather than silently dropping it", () => {
    const state = { resetSystemSelections: { metrics: "v1" as const, legislation: "v2" as const } };
    expect(resetSystemSelectionsFrom(state).legislation).toBe("v1");
    expect(resetSelectionPreflight(state, "1991-default", true, ready)).toEqual({
      allowed: false,
      reason: "Reset v2 legislation and Cabinet require metrics v2",
    });
  });
});
