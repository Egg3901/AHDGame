/**
 * All-states dry-run matrix for #1165 (regional demographic leans).
 *
 * Runs the deterministic DB-free dry-run once and asserts the whole contract:
 * every census state resolves, the Deep South Black-conditioned electorate is
 * socially left at the 1953 baseline and stays left under the full Brown
 * overlay while the white electorate moves right on both axes, control states
 * author no conditioned offsets, the economic band is preserved (the
 * correction is social-only and Deep South Black econ stays left through
 * Brown), and pruning keeps every present bucket's counterweight mass.
 */
import { describe, it, expect } from "vitest";
import {
  runDeepSouthDryRun,
  dryRunBrownOverlay,
  DRY_RUN_DEEP_SOUTH,
  type DeepSouthDryRun,
} from "./deepSouthElectorateDryRun";
import { conditionedOffsetsAtAnchor } from "@/lib/seeds/demographicCategories";
import { stateCensusData1953 } from "@/lib/seeds/stateCensusData1953";
import { ELECTORATE_REPRESENTATION_FRACTION } from "@/lib/demographics/granularElectorate";

let run: DeepSouthDryRun;
describe("deepSouthElectorateDryRun", () => {
  it("resolves every census state deterministically", () => {
    run = runDeepSouthDryRun();
    const censusStates = Object.keys(stateCensusData1953).sort();
    expect(run.rows.map((r) => r.stateId)).toEqual(censusStates);
    expect(new Set(run.rows.map((r) => r.stateId)).size).toBe(censusStates.length);
    for (const r of run.rows) {
      expect(r.white, `${r.stateId} white electorate`).not.toBeNull();
    }
    // Deterministic: a second run is value-identical.
    expect(runDeepSouthDryRun()).toEqual(run);
  });

  it("keeps the Deep South Black electorate left at baseline and through Brown", () => {
    for (const stateId of DRY_RUN_DEEP_SOUTH) {
      const row = run.rows.find((r) => r.stateId === stateId)!;
      expect(row.black, `${stateId} black baseline`).not.toBeNull();
      expect(row.black!.soc, `${stateId} black baseline social`).toBeLessThan(-0.15);
      expect(row.blackBrown, `${stateId} black Brown`).not.toBeNull();
      expect(row.blackBrown!.soc, `${stateId} black Brown social`).toBeLessThan(-0.3);
      expect(row.black!.share, `${stateId} black share`).toBeGreaterThan(0.2);
    }
  });

  it("moves the Deep South white electorate right under Brown", () => {
    for (const stateId of DRY_RUN_DEEP_SOUTH) {
      const row = run.rows.find((r) => r.stateId === stateId)!;
      expect(row.white!.soc, `${stateId} white baseline social`).toBeGreaterThan(1.5);
      expect(row.whiteBrown!.soc, `${stateId} white Brown social`).toBeGreaterThan(
        row.white!.soc + 0.1
      );
      expect(row.whiteBrown!.soc, `${stateId} white Brown lands right`).toBeGreaterThan(2.5);
      expect(row.whiteBrown!.econ, `${stateId} white Brown econ`).toBeGreaterThan(
        row.white!.econ + 0.5
      );
      expect(
        row.whiteBrown!.soc - row.blackBrown!.soc,
        `${stateId} polarization gap widens`
      ).toBeGreaterThan(row.white!.soc - row.black!.soc);
    }
  });

  it("authors conditioned offsets only in the 1953 Deep South", () => {
    for (const row of run.rows) {
      const isDeepSouth = (DRY_RUN_DEEP_SOUTH as readonly string[]).includes(row.stateId);
      expect(row.hasOffsets, row.stateId).toBe(isDeepSouth);
    }
    // Later anchors author none anywhere.
    for (const stateId of DRY_RUN_DEEP_SOUTH) {
      expect(conditionedOffsetsAtAnchor("1979", stateId), stateId).toEqual([]);
    }
  });

  it("keeps Northern Black-conditioned electorates left without offsets", () => {
    for (const stateId of ["NY", "CA", "MA"]) {
      const row = run.rows.find((r) => r.stateId === stateId)!;
      expect(row.hasOffsets, stateId).toBe(false);
      expect(row.black, `${stateId} black present`).not.toBeNull();
      expect(row.black!.soc, `${stateId} black social`).toBeLessThan(0);
    }
  });

  it("preserves the economic band (social-only correction, left Black econ)", () => {
    // Every authored offset is social-only: nothing on the econ axis moves.
    for (const stateId of DRY_RUN_DEEP_SOUTH) {
      for (const o of conditionedOffsetsAtAnchor("1953", stateId)) {
        expect(o.economicLean, `${stateId} ${String(o.dim)}:${o.bucket} econ`).toBe(0);
      }
    }
    // And the Brown overlay carries no econ shift on race:black itself, so
    // the Deep South Black electorate stays economically left throughout.
    const brown = dryRunBrownOverlay();
    expect(brown.race?.black?.economicLean ?? 0).toBeLessThanOrEqual(0);
    for (const stateId of DRY_RUN_DEEP_SOUTH) {
      const row = run.rows.find((r) => r.stateId === stateId)!;
      expect(row.black!.econ, `${stateId} black baseline econ`).toBeLessThan(0);
      expect(row.blackBrown!.econ, `${stateId} black Brown econ`).toBeLessThan(0);
    }
  });

  it("keeps every present bucket's counterweight mass through pruning", () => {
    for (const row of run.rows) {
      expect(row.minKeptRatio, `${row.stateId} min kept/marginal`).toBeGreaterThanOrEqual(
        ELECTORATE_REPRESENTATION_FRACTION - 1e-6
      );
    }
  });
});
