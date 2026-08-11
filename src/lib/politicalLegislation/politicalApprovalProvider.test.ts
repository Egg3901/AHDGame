import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { StateMetrics } from "@/lib/db/types";
import { POLITICAL_METRIC_FAMILIES } from "@/lib/politicalMetrics/families";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";
import { BASE_APPROVAL, calculateStateApproval } from "@/lib/utils/governmentApproval";
import {
  APPROVAL_NEUTRAL_SCORE,
  APPROVAL_POINTS_PER_SCORE,
  approvalComponent,
} from "./politicalApproval";
import {
  isPoliticalApprovalCountry,
  loadPoliticalApprovalBases,
} from "./politicalApprovalProvider";

function uniformValues(v: number): Record<PoliticalMetricId, number> {
  const out = {} as Record<PoliticalMetricId, number>;
  for (const f of POLITICAL_METRIC_FAMILIES) out[f.id] = v;
  return out;
}

describe("seed splitter", () => {
  it("writes NO legacy political half for any board country", async () => {
    // Phase 3: the split gate uses the routing predicate now. Every board
    // country's readers are on the board and its legislation lands there, so a
    // legacy copy would be written and never read.
    const { splitMetricsDoc } = await import("@/lib/macroMetrics/split");
    for (const countryId of ["US", "UK", "RU", "DD", "JP", "DE", "HU"]) {
      const out = splitMetricsDoc({
        _id: "R1",
        countryId,
        education: { literacyRate: { value: 99 } },
      } as unknown as StateMetrics);
      // The political half no longer exists at all — the extractor returns
      // only `macro`, for every country.
      expect((out as unknown as Record<string, unknown>).political, countryId).toBeUndefined();
      expect(out.macro, countryId).not.toBeNull();
    }
  });
});

describe("isPoliticalApprovalCountry", () => {
  it("matches every country with a board, playable or not", () => {
    for (const id of ["US", "UK", "RU", "DD"]) expect(isPoliticalApprovalCountry(id)).toBe(true);
    for (const id of ["JP", "DE", "HU", "YU", "NG"]) {
      expect(isPoliticalApprovalCountry(id), id).toBe(true);
    }
    expect(isPoliticalApprovalCountry("ZZ")).toBe(false);
    expect(isPoliticalApprovalCountry(null)).toBe(false);
    expect(isPoliticalApprovalCountry(undefined)).toBe(false);
  });

  it("stays in sync with the emitted board rather than a hand-written list", async () => {
    const { NON_PLAYABLE_BOARDS } = await import("@/lib/politicalMetrics/seeds/nonPlayableBoards");
    // Keyed by PRESET first — the countries are one level down.
    for (const byCountry of Object.values(NON_PLAYABLE_BOARDS)) {
      for (const id of Object.keys(byCountry)) {
        expect(isPoliticalApprovalCountry(id), id).toBe(true);
      }
    }
  });
});

describe("loadPoliticalApprovalBases", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
  });

  it("returns null when the country has no politicalMetrics docs", async () => {
    db.collection("politicalMetrics").find().toArray.mockResolvedValue([]);
    db.collection("states").find().toArray.mockResolvedValue([]);
    expect(await loadPoliticalApprovalBases(db as unknown as Db, "US")).toBeNull();
  });

  it("computes BASE_APPROVAL + component per region and a population-weighted national", async () => {
    const neutral = APPROVAL_NEUTRAL_SCORE.US;
    db.collection("politicalMetrics")
      .find()
      .toArray.mockResolvedValue([
        { _id: "MI", countryId: "US", values: uniformValues(neutral + 10) },
        { _id: "AL", countryId: "US", values: uniformValues(neutral - 10) },
      ]);
    db.collection("states")
      .find()
      .toArray.mockResolvedValue([
        {
          _id: "MI",
          countryId: "US",
          population: 3_000_000,
          cachedEconomicLean: 0,
          cachedSocialLean: 0,
        },
        {
          _id: "AL",
          countryId: "US",
          population: 1_000_000,
          cachedEconomicLean: 0,
          cachedSocialLean: 0,
        },
      ]);
    const bases = await loadPoliticalApprovalBases(db as unknown as Db, "US");
    expect(bases).not.toBeNull();
    const up = BASE_APPROVAL + 10 * APPROVAL_POINTS_PER_SCORE;
    const down = BASE_APPROVAL - 10 * APPROVAL_POINTS_PER_SCORE;
    expect(bases!.byRegion.get("MI")).toBeCloseTo(up, 6);
    expect(bases!.byRegion.get("AL")).toBeCloseTo(down, 6);
    expect(bases!.national).toBeCloseTo((up * 3 + down) / 4, 1);
  });

  it("uses each region's cached leans for the affinity term", async () => {
    // Right-lean board: +lean families excellent. A +4 electorate region must
    // score a higher base than a -4 electorate region on the SAME board.
    const board = {} as Record<PoliticalMetricId, number>;
    for (const f of POLITICAL_METRIC_FAMILIES) board[f.id] = f.lean > 0 ? 80 : 40;
    db.collection("politicalMetrics")
      .find()
      .toArray.mockResolvedValue([
        { _id: "R", countryId: "US", values: board },
        { _id: "L", countryId: "US", values: board },
      ]);
    db.collection("states")
      .find()
      .toArray.mockResolvedValue([
        { _id: "R", countryId: "US", population: 1, cachedEconomicLean: 4, cachedSocialLean: 4 },
        { _id: "L", countryId: "US", population: 1, cachedEconomicLean: -4, cachedSocialLean: -4 },
      ]);
    const bases = await loadPoliticalApprovalBases(db as unknown as Db, "US");
    expect(bases!.byRegion.get("R")!).toBeGreaterThan(bases!.byRegion.get("L")!);
  });
});

describe("baseOverride seam", () => {
  it("calculateStateApproval uses the override and still applies modifiers on top", () => {
    const emptyMetrics = { _id: "X", countryId: "US" } as unknown as StateMetrics;
    // No metrics + no modifiers: result is exactly the override.
    expect(calculateStateApproval(emptyMetrics, {}, [], undefined, null, null, 62)).toBe(62);
    // Extra modifiers still apply on top of the override.
    const withMod = calculateStateApproval(
      emptyMetrics,
      {},
      [{ id: "m", label: "m", effect: -5 }],
      undefined,
      null,
      null,
      62
    );
    expect(withMod).toBe(57);
    // Omitted override preserves legacy behavior (BASE_APPROVAL for empty docs).
    expect(calculateStateApproval(emptyMetrics, {}, [], undefined, null, null)).toBe(BASE_APPROVAL);
  });

  it("component matches the provider arithmetic end to end", () => {
    const values = uniformValues(APPROVAL_NEUTRAL_SCORE.UK + 6);
    expect(approvalComponent(values, 0, "UK")).toBeCloseTo(6 * APPROVAL_POINTS_PER_SCORE, 9);
  });
});
