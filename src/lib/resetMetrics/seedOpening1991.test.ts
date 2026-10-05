import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { primaryMetrics } from "./catalog";
import { buildOpeningMetricSnapshots1991, seedOpeningMetrics1991 } from "./seedOpening1991";
import { RESET_V2_SEED_REVISION } from "@/lib/resetVersions/rules";
import { buildResetMetricSnapshot } from "./rules/snapshot";
import {
  openingFertilityPolicyInputs1991,
  openingLifeCalibration1991,
  openingMigrationPolicyInputs1991,
} from "./openingSeed1991";
import { birthRateIndexToTFR } from "@/lib/demographics/flows/fertility";

describe("1991 reset metric opening", () => {
  it("keeps a complete opening migration-policy input separate from realized flow", () => {
    const migration = openingMigrationPolicyInputs1991();
    const boards = buildOpeningMetricSnapshots1991("world-test", 1);
    for (const board of boards.filter((row) => row.scope === "regional")) {
      expect(Number.isFinite(migration[board.countryId][board.regionId!])).toBe(true);
    }
    expect(
      Object.values(migration).reduce((sum, regions) => sum + Object.keys(regions).length, 0)
    ).toBe(71);
  });

  it("feeds cohorts the same rebased fertility targets as the v2 opening board", () => {
    const fertility = openingFertilityPolicyInputs1991();
    const boards = buildOpeningMetricSnapshots1991("world-test", 1);
    for (const board of boards.filter((row) => row.scope === "regional")) {
      const index = fertility[board.countryId][board.regionId!];
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThanOrEqual(100);
      expect(birthRateIndexToTFR(index!, 2.06)).toBeCloseTo(board.observations["55"]!.value!);
    }
  });

  it("anchors the live life table to each region's same 1991 metric opening", () => {
    const calibration = openingLifeCalibration1991();
    const boards = buildOpeningMetricSnapshots1991("world-test", 1);
    for (const board of boards.filter((row) => row.scope === "regional")) {
      const regional = calibration[board.countryId][board.regionId!];
      expect(regional).toBeDefined();
      expect(regional!.modeledYears).toBeGreaterThan(70);
      expect(regional!.modeledYears).toBeLessThan(90);
      expect(regional!.openingYears).toBeCloseTo(board.observations["20"]!.value!);
    }
  });

  it("contains complete, finite, scoped boards for all three countries and 71 regions", () => {
    const rows = buildOpeningMetricSnapshots1991("world-test", 1);
    const nationalCount = primaryMetrics.filter(
      (metric) => metric.aggregation === "national"
    ).length;
    expect(rows).toHaveLength(74);
    expect(rows.filter((row) => row.scope === "national")).toHaveLength(3);
    expect(new Set(rows.map((row) => row._id)).size).toBe(74);
    for (const row of rows) {
      expect(Object.keys(row.observations)).toHaveLength(
        row.scope === "national" ? nationalCount : primaryMetrics.length - nationalCount
      );
      expect(
        Object.values(row.observations).every((observation) => observation.value !== null)
      ).toBe(true);
    }
  });

  it("rejects a missing or unavailable primary before writing", () => {
    const row = buildOpeningMetricSnapshots1991("world-test", 1)[0]!;
    const missing = { ...row.observations };
    delete missing[Object.keys(missing)[0]!];
    expect(() => buildResetMetricSnapshot({ ...row, observations: missing })).toThrow(
      "incomplete national primary board"
    );
    const broken = { ...row.observations };
    const id = Object.keys(broken)[0]!;
    broken[id] = { ...broken[id]!, value: null, status: "unavailable" };
    expect(() => buildResetMetricSnapshot({ ...row, observations: broken })).toThrow(
      `national/${id} is not ready`
    );
  });

  it("issues a world-bound receipt only after exact persisted readback", async () => {
    const db = createMockDb();
    const rows = buildOpeningMetricSnapshots1991("world-test", 1);
    db.collection("states").find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue(
          rows
            .filter((row) => row.scope === "regional")
            .map((row) => ({ _id: row.regionId, countryId: row.countryId }))
        ),
    });
    db.collection("resetMetricSnapshots").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(rows),
    });
    const receipt = await seedOpeningMetrics1991(db as unknown as Db, "world-test", 1);
    expect(receipt).toMatchObject({
      worldId: "world-test",
      revision: RESET_V2_SEED_REVISION.metrics,
      sourceTurn: 1,
      verificationHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(db.collectionMocks.resetMetricSnapshots!.bulkWrite).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.resetMetricSnapshots!.bulkWrite.mock.calls[0]![0]).toHaveLength(74);
    expect(db.collectionMocks.macroMetrics).toBeUndefined();
    expect(db.collectionMocks.politicalMetrics).toBeUndefined();
  });

  it("refuses a receipt if one persisted observation changed or an old world survived", async () => {
    const db = createMockDb();
    const rows = buildOpeningMetricSnapshots1991("world-test", 1);
    db.collection("states").find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue(
          rows
            .filter((row) => row.scope === "regional")
            .map((row) => ({ _id: row.regionId, countryId: row.countryId }))
        ),
    });
    const tampered = structuredClone(rows);
    tampered[0]!.observations["07"]!.value = 99;
    db.collection("resetMetricSnapshots").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(tampered),
    });
    await expect(seedOpeningMetrics1991(db as unknown as Db, "world-test", 1)).rejects.toThrow(
      "failed readback verification"
    );

    db.collection("resetMetricSnapshots").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([...rows, { ...rows[0], worldId: "old-world" }]),
    });
    await expect(seedOpeningMetrics1991(db as unknown as Db, "world-test", 1)).rejects.toThrow(
      "failed readback verification"
    );
  });

  it("rejects a missing seeded region before persisting any v2 board", async () => {
    const db = createMockDb();
    db.collection("states").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    await expect(seedOpeningMetrics1991(db as unknown as Db, "world-test", 1)).rejects.toThrow(
      "regions do not match"
    );
    expect(db.collectionMocks.resetMetricSnapshots).toBeUndefined();
  });
});
