import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { regionalDefaultLaws } from "@/lib/politicalLegislation/regionalDefaults";
import { LAW_COUNTRY_IDS } from "@/lib/politicalLegislation/types";
import { migration } from "./2026-08-31-regional-default-laws-newgen";

const REGIONS: Record<string, string[]> = {
  US: ["CA", "TX"],
  UK: ["LON"],
  RU: ["MOW"],
  DD: ["BEO", "MV", "BB", "ST", "SN", "TH"],
};

function expectedPairs(): number {
  return LAW_COUNTRY_IDS.reduce(
    (sum, cc) => sum + regionalDefaultLaws(cc).length * REGIONS[cc].length,
    0
  );
}

describe("2026-08-31-regional-default-laws-newgen", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("states").find.mockImplementation((filter?: { countryId?: string }) => ({
      project: () => ({
        toArray: async () => (REGIONS[filter?.countryId ?? ""] ?? []).map((_id) => ({ _id })),
      }),
      toArray: async () => (REGIONS[filter?.countryId ?? ""] ?? []).map((_id) => ({ _id })),
    }));
    db.collection("statePolicies").find.mockReturnValue({
      project: () => ({ toArray: async () => [] }),
      toArray: async () => [],
    });
    db.collection("statePolicies").bulkWrite.mockResolvedValue({ upsertedCount: 0 });
  });

  it("is registered as idempotent", () => {
    expect(migration.idempotent).toBe(true);
    expect(migration.id).toBe("2026-08-31-regional-default-laws-newgen");
  });

  it("writes nothing on a dry run but reports what it would insert", async () => {
    const result = await migration.execute(db as unknown as Db, { dryRun: true });
    expect(db.collectionMocks["statePolicies"]!.bulkWrite).not.toHaveBeenCalled();
    expect(result.documentsScanned).toBe(expectedPairs());
    expect(result.notes?.join(" ")).toContain("dry run");
  });

  it("inserts one level-0 row per missing (region, `both` law) pair", async () => {
    await migration.execute(db as unknown as Db, { dryRun: false });
    const ops = db.collectionMocks["statePolicies"]!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: {
        filter: { scope: string; stateId: string; legislationTypeId: string };
        update: { $setOnInsert: { policyOptionIndex: number; policyOptionId: string } };
        upsert: boolean;
      };
    }>;

    expect(ops.length).toBe(expectedPairs());
    for (const op of ops) {
      expect(op.updateOne.upsert).toBe(true);
      expect(op.updateOne.filter.scope).toBe("state");
      expect(op.updateOne.update.$setOnInsert.policyOptionIndex).toBe(0);
      expect(op.updateOne.update.$setOnInsert.policyOptionId).toBe("l0");
    }
  });

  it("is insert-only — an existing row is never rewritten", async () => {
    const ruLaw = regionalDefaultLaws("RU")[0]!;
    db.collection("statePolicies").find.mockImplementation(() => ({
      project: () => ({
        toArray: async () => [{ stateId: "MOW", legislationTypeId: ruLaw.id }],
      }),
      toArray: async () => [{ stateId: "MOW", legislationTypeId: ruLaw.id }],
    }));

    await migration.execute(db as unknown as Db, { dryRun: false });
    const ops = db.collectionMocks["statePolicies"]!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { filter: { stateId: string; legislationTypeId: string } };
    }>;

    expect(ops.length).toBe(expectedPairs() - 1);
    expect(
      ops.some(
        (op) =>
          op.updateOne.filter.stateId === "MOW" &&
          op.updateOne.filter.legislationTypeId === ruLaw.id
      )
    ).toBe(false);
  });

  it("re-running after a full backfill is a no-op", async () => {
    db.collection("statePolicies").find.mockImplementation((filter?: { stateId?: unknown }) => {
      const ids = ((filter?.stateId as { $in?: string[] })?.$in ?? []) as string[];
      const rows = LAW_COUNTRY_IDS.flatMap((cc) =>
        REGIONS[cc]
          .filter((r) => ids.includes(r))
          .flatMap((stateId) =>
            regionalDefaultLaws(cc).map((law) => ({ stateId, legislationTypeId: law.id }))
          )
      );
      return { project: () => ({ toArray: async () => rows }), toArray: async () => rows };
    });

    const result = await migration.execute(db as unknown as Db, { dryRun: false });
    expect(db.collectionMocks["statePolicies"]!.bulkWrite).not.toHaveBeenCalled();
    expect(result.documentsInserted).toBe(0);
  });

  it("skips DD regions outside the authored Land list", async () => {
    db.collection("states").find.mockImplementation((filter?: { countryId?: string }) => {
      const ids =
        filter?.countryId === "DD"
          ? [...REGIONS.DD, "PHANTOM-BEZIRK"]
          : (REGIONS[filter?.countryId ?? ""] ?? []);
      return {
        project: () => ({ toArray: async () => ids.map((_id) => ({ _id })) }),
        toArray: async () => ids.map((_id) => ({ _id })),
      };
    });

    await migration.execute(db as unknown as Db, { dryRun: false });
    const ops = db.collectionMocks["statePolicies"]!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { filter: { stateId: string } };
    }>;
    expect(ops.some((op) => op.updateOne.filter.stateId === "PHANTOM-BEZIRK")).toBe(false);
  });
});
