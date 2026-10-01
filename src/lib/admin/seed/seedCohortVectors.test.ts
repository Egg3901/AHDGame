import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { bulkOps, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { frRegions1991 } from "@/lib/countries/fr/data/frRegions1991";
import { esRegions1991 } from "@/lib/countries/es/data/esRegions1991";
import { seedCohortVectors } from "./seedCohortVectors";

function withStatesAndMetrics(db: MockDb, states: unknown[], metrics: unknown[]) {
  // Vivify the lazily-created collection mocks before overriding them.
  db.collection("states");
  db.collection("macroMetrics");
  db.collection("regionDemographics");
  db.collectionMocks.states!.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(states),
  } as never);
  db.collectionMocks.macroMetrics!.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(metrics),
  } as never);
}

describe("seedCohortVectors", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it.each([
    ["FR", frRegions1991],
    ["ES", esRegions1991],
  ] as const)(
    "seeds all eight %s1991 regions without missing age profiles",
    async (_country, regions) => {
      withStatesAndMetrics(db, regions, []);
      const stats = await seedCohortVectors(db as unknown as Db, "1991-default", () => {});
      expect(stats.covered).toBe(8);
      expect(stats.skipped).toEqual([]);
      expect(stats.totalTargetPop).toBe(regions.reduce((sum, row) => sum + row.population, 0));
      expect(Math.abs(stats.totalPeople - stats.totalTargetPop)).toBeLessThanOrEqual(8 * 101);
      expect(bulkOps(db.collectionMocks.regionDemographics!.bulkWrite)).toHaveLength(8);
    }
  );

  it("builds a 101-bin age/sex vector and stamps derived population metrics", async () => {
    withStatesAndMetrics(
      db,
      [{ _id: "DUB", countryId: "IE", population: 1_400_000 }],
      [
        {
          _id: "DUB",
          population: {
            medianAge: { value: 29 },
            birthRate: { value: 70 },
            migrationRate: { value: 6 },
          },
        },
      ]
    );

    const stats = await seedCohortVectors(db as unknown as Db, "1991-default", () => {});

    expect(stats.covered).toBe(1);
    expect(stats.skipped).toHaveLength(0);

    const demoSet = bulkOps(db.collectionMocks.regionDemographics!.bulkWrite)[0]![1] as {
      $set: { ages: { male: number[]; female: number[] }; countryId: string };
    };
    expect(demoSet.$set.countryId).toBe("IE");
    expect(demoSet.$set.ages.male).toHaveLength(101);
    expect(demoSet.$set.ages.female).toHaveLength(101);

    const metricSet = bulkOps(db.collectionMocks.macroMetrics!.bulkWrite)[0]![1] as {
      $set: Record<string, number>;
    };
    const sex = metricSet.$set["population.sexRatio.value"];
    const dep = metricSet.$set["population.dependencyRatio.value"];
    expect(sex).toBeGreaterThan(0);
    expect(sex).toBeLessThanOrEqual(100);
    expect(dep).toBeGreaterThan(0);
    expect(dep).toBeLessThanOrEqual(3);
    // realizedMigrationRate seeded from the configured migrationRate (clamped ±10).
    expect(metricSet.$set["population.realizedMigrationRate.value"]).toBe(6);
  });

  it("skips regions with no census or zero population (and writes nothing in dry-run)", async () => {
    withStatesAndMetrics(
      db,
      [
        { _id: "DUB", countryId: "IE", population: 0 }, // zero pop → skipped
        { _id: "ZZZ", countryId: "IE", population: 100 }, // no census → skipped
      ],
      []
    );

    const stats = await seedCohortVectors(db as unknown as Db, "2019-default", () => {}, {
      apply: false,
    });

    expect(stats.covered).toBe(0);
    expect(stats.skipped).toHaveLength(2);
    // Asserted against `bulkWrite`, which is what the seeder actually calls.
    // Left pointing at `updateOne` these would pass no matter what the dry run
    // wrote, since the seeder no longer calls `updateOne` on any path at all.
    expect(db.collectionMocks.regionDemographics!.bulkWrite).not.toHaveBeenCalled();
    expect(db.collectionMocks.macroMetrics!.bulkWrite).not.toHaveBeenCalled();
  });
});
