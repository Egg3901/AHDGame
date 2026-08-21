import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { seedUkBudgets } from "./seedUkBudgets";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

/**
 * The regional-policy block at the end of `seedUkBudgets` seeds one statePolicy
 * per legacy `countryScope: "uk"` type. On a political-legislation preset those
 * types are deliberately unseeded (and pruned) by `seedLegislationTypes`, so
 * writing the policies anyway leaves 216 rows (18 types × 12 regions) pointing
 * at legislation that does not exist — which is exactly what live carries.
 */
describe("seedUkBudgets regional policy seeding", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    for (const name of [
      "states",
      "statePolicies",
      "federalBudget",
      "stateBudgets",
      "enactedLaws",
      "corporations",
      "corporateSectors",
    ]) {
      db.collection(name);
    }
    db.collectionMocks["states"]!.find.mockImplementation(() => ({
      toArray: vi.fn().mockResolvedValue([
        { _id: "LON", countryId: "UK", population: 9_206_136, gdp: 3442 },
        { _id: "SCO", countryId: "UK", population: 5_611_190, gdp: 1398 },
      ]),
      sort: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    }));
  });

  const seededTypeIds = () => {
    const bulkWrite = db.collectionMocks["statePolicies"]!.bulkWrite;
    if (bulkWrite.mock.calls.length === 0) return [];
    const ops = bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { filter: { legislationTypeId?: string } };
    }>;
    return [...new Set(ops.map((op) => op.updateOne.filter.legislationTypeId))];
  };

  it("seeds no legacy uk_* regional policies on a political-legislation preset", async () => {
    await seedUkBudgets(db as unknown as Db, false, () => {}, "1953-default");

    expect(seededTypeIds().filter((id) => id?.startsWith("uk_"))).toEqual([]);
  });

  it("seeds no legacy uk_* regional policies on the modern preset either", async () => {
    // `isPoliticalPipelinePreset` is unconditionally true — the v2 law book runs
    // at every preset, so the legacy UK catalog is pruned from every world and
    // there is no preset where seeding these rows would resolve to real types.
    await seedUkBudgets(db as unknown as Db, false, () => {}, "default");

    expect(seededTypeIds().filter((id) => id?.startsWith("uk_"))).toEqual([]);
  });
});
