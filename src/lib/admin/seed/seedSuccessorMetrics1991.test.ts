import { randomUUID } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { NATIONAL_SCOPE } from "@/lib/constants/nationalScope";
import { SUCCESSOR_STATE_METRICS_1991 } from "@/lib/seeds/reference/successorMetrics1991";
import { buildCountryReadinessReport } from "@/lib/admin/countryReadinessReport";
import { regionBundleFor } from "@/lib/admin/seedDiagnostic/regionBundles";
import { regionalMetricCoverage } from "@/lib/admin/seedDiagnostic/regionalCoverage";
import { seedSuccessorMetrics1991 } from "./seedSuccessorMetrics1991";

describe("1991 metric roster cleanup", () => {
  it("purges obsolete metrics only after the complete authored vectors are written", async () => {
    const db = createMockDb();
    await seedSuccessorMetrics1991(db as unknown as Db, false, "1991-default", () => {});
    expect(db.collectionMocks.macroMetrics.deleteMany).toHaveBeenCalledOnce();
    expect(db.collectionMocks.macroMetrics.bulkWrite.mock.invocationCallOrder.at(-1)).toBeLessThan(
      db.collectionMocks.macroMetrics.deleteMany.mock.invocationCallOrder[0]
    );
  });

  it("leaves other presets untouched", async () => {
    const db = createMockDb();
    await seedSuccessorMetrics1991(db as unknown as Db, true, "1979-default", () => {});
    expect(db.collection).not.toHaveBeenCalled();
  });

  it("does not purge rows after an interrupted vector write", async () => {
    const db = createMockDb();
    db.collection("macroMetrics");
    db.collectionMocks.macroMetrics.bulkWrite.mockRejectedValueOnce(new Error("write interrupted"));
    await expect(
      seedSuccessorMetrics1991(db as unknown as Db, false, "1991-default", vi.fn())
    ).rejects.toThrow("write interrupted");
    expect(db.collectionMocks.macroMetrics.deleteMany).not.toHaveBeenCalled();
  });
});

const LEGACY_ROWS = {
  HU: ["HU_HUN"],
  PL: ["PL_CEN", "PL_NOR", "PL_SOU"],
  YU: ["YU_CEN", "YU_NW", "YU_SOU"],
  BG: ["BG_BUL"],
  CS: ["CS_CZ"],
  RU: ["BEL", "BLT", "CAS", "KAZ", "MOL", "TRA", "UKR"],
};

describe.skipIf(process.env.AHD_1991_METRIC_ROSTER_REAL_MONGO !== "1")(
  "1991 metric reseed against disposable Mongo",
  () => {
    it.each([false, true])(
      "removes all six orphan warnings with reset=%s and preserves unrelated data",
      async (reset) => {
        const client = await MongoClient.connect("mongodb://127.0.0.1:27018", {
          maxPoolSize: 2,
          serverSelectionTimeoutMS: 5_000,
        });
        const name = `ahd_sim_1991_metric_roster_${randomUUID().replaceAll("-", "")}`;
        const db = client.db(name);
        const metrics = db.collection<{ _id: string; countryId?: string; marker?: string }>(
          "macroMetrics"
        );
        try {
          await metrics.insertMany([
            ...Object.entries(LEGACY_ROWS).flatMap(([countryId, ids]) =>
              ids.map((_id) => ({ _id, countryId }))
            ),
            ...Object.entries(NATIONAL_SCOPE).map(([_id, countryId]) => ({
              _id,
              countryId,
              marker: "preserve national summary",
            })),
            { _id: "foreign-region", countryId: "US", marker: "preserve foreign" },
            { _id: "unscoped-region", marker: "preserve unscoped" },
          ]);
          await seedSuccessorMetrics1991(db, reset, "1991-default", () => {});
          for (const countryId of Object.keys(LEGACY_ROWS) as (keyof typeof LEGACY_ROWS)[]) {
            const regions = regionBundleFor(countryId, "1991-default")!;
            const rows = await metrics.find({ countryId }, { projection: { _id: 1 } }).toArray();
            expect(
              regionalMetricCoverage(
                countryId,
                regions.map((region) => region._id),
                rows.map((row) => row._id)
              ).severity,
              countryId
            ).toBe("ok");
          }
          expect(await metrics.countDocuments({ marker: "preserve national summary" })).toBe(
            Object.keys(NATIONAL_SCOPE).length
          );
          expect(await metrics.findOne({ _id: "foreign-region" })).toMatchObject({
            marker: "preserve foreign",
          });
          expect(await metrics.findOne({ _id: "unscoped-region" })).toMatchObject({
            marker: "preserve unscoped",
          });
          const ids = (await metrics.find({}, { projection: { _id: 1 } }).toArray())
            .map((row) => row._id)
            .sort();
          expect(
            await metrics.countDocuments({
              _id: { $in: SUCCESSOR_STATE_METRICS_1991.map((m) => m._id) },
            })
          ).toBe(SUCCESSOR_STATE_METRICS_1991.length);
          const readiness = await buildCountryReadinessReport(db, "RU", "1991-default");
          expect(readiness?.checks.find((check) => check.name === "RegionMetrics")).toMatchObject({
            count: 24,
            status: "ok",
          });
          const republicId = regionBundleFor("RU", "1991-default")!.find((region) =>
            region._id.startsWith("SU_")
          )!._id;
          await metrics.deleteOne({ _id: republicId });
          const incomplete = await buildCountryReadinessReport(db, "RU", "1991-default");
          expect(incomplete?.checks.find((check) => check.name === "RegionMetrics")).toMatchObject({
            count: 23,
            status: "warning",
          });
          await seedSuccessorMetrics1991(db, false, "1991-default", () => {});
          expect(
            (await metrics.find({}, { projection: { _id: 1 } }).toArray())
              .map((row) => row._id)
              .sort()
          ).toEqual(ids);
        } finally {
          expect(db.databaseName).toBe(name);
          await db.dropDatabase();
          await client.close();
        }
      }
    );
  }
);
