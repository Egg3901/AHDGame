import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { seedParties, seedStatePartyOrg } from "./seedParties";
import { fillAbsentSeedFields } from "./fillAbsentSeedFields";
import { politicalParties } from "@/lib/seeds/reference/politicalParties";
import { generateStatePartyOrg } from "@/lib/seeds/reference/statePartyOrg";

/**
 * A Democratic Party row as it looks in a world that has actually been played:
 * money raised, an elected chair, members, a proposal-voted position shift and
 * a chair-chosen colour. Every one of these fields also appears in the seed.
 */
function livePlayedDemocrats() {
  const seed = politicalParties.find((p) => p.name === "Democratic Party")!;
  const { seedOrder: _seedOrder, ...body } = seed;
  return {
    ...body,
    _id: "party-dem-oid",
    sequentialId: 1,
    treasury: 48_250_000,
    memberCount: 137,
    chairId: "char-9001",
    viceChairId: "char-9002",
    politicalStrength: 61,
    economicPosition: -4,
    color: "#1D4ED8",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-07-01"),
  };
}

function setFieldsOf(mockFn: { mock: { calls: unknown[][] } }, callIndex = 0) {
  const update = mockFn.mock.calls[callIndex]?.[1] as { $set?: Record<string, unknown> };
  return update?.$set ?? {};
}

describe("fillAbsentSeedFields", () => {
  it("returns only keys the stored document does not have", () => {
    const gaps = fillAbsentSeedFields({ a: 1, b: 2, c: 3 }, { a: 99, b: 0 });
    expect(gaps).toEqual({ c: 3 });
  });

  it("treats null as present, not as a gap", () => {
    const gaps = fillAbsentSeedFields({ chairId: "seed-chair" }, { chairId: null });
    expect(gaps).toEqual({});
  });

  it("treats a falsy stored value as present", () => {
    const gaps = fillAbsentSeedFields({ treasury: 1_000_000 }, { treasury: 0 });
    expect(gaps).toEqual({});
  });
});

describe("seedParties", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    // getNextSequentialId reads back the incremented counter.
    let seq = 0;
    db.collection("counters");
    db.collectionMocks.counters!.findOneAndUpdate.mockImplementation(async () => ({ seq: ++seq }));
  });

  it("inserts a default party that does not exist yet", async () => {
    await seedParties(db as unknown as Db, () => {});

    const inserts = db.collectionMocks.politicalParties!.insertOne.mock.calls;
    expect(inserts).toHaveLength(politicalParties.length);
    expect(inserts[0]![0]).toMatchObject({ name: "Democratic Party", countryId: "US" });
    expect(db.collectionMocks.politicalParties!.updateOne).not.toHaveBeenCalled();
  });

  it("never overwrites live party state on a reseed", async () => {
    const live = livePlayedDemocrats();
    db.collection("politicalParties");
    db.collectionMocks.politicalParties!.findOne.mockImplementation(
      async (filter: { name: string }) => (filter.name === "Democratic Party" ? live : null)
    );

    await seedParties(db as unknown as Db, () => {});

    // The Democrats matched an existing complete row: no write at all, so the
    // $48M treasury, elected chair, 137 members, shifted economicPosition and
    // chair-chosen colour all survive. (Republicans are still inserted.)
    const updates = db.collectionMocks.politicalParties!.updateOne.mock.calls;
    expect(updates).toHaveLength(0);
    const inserted = db.collectionMocks.politicalParties!.insertOne.mock.calls;
    expect(inserted).toHaveLength(1);
    expect(inserted[0]![0]).toMatchObject({ name: "Republican Party" });
  });

  it("fills a field the stored row is missing, and only that field", async () => {
    const live = livePlayedDemocrats();
    // Simulate a row written before `culture` was added to the party seed.
    delete (live as Record<string, unknown>).culture;
    db.collection("politicalParties");
    db.collectionMocks.politicalParties!.findOne.mockImplementation(
      async (filter: { name: string }) => (filter.name === "Democratic Party" ? live : null)
    );

    await seedParties(db as unknown as Db, () => {});

    const $set = setFieldsOf(db.collectionMocks.politicalParties!.updateOne);
    expect(Object.keys($set).sort()).toEqual(["culture", "updatedAt"]);
    expect($set.treasury).toBeUndefined();
    expect($set.chairId).toBeUndefined();
  });
});

describe("seedStatePartyOrg", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  function withExistingOrgRows(rows: unknown[]) {
    db.collection("statePartyOrg");
    db.collectionMocks.statePartyOrg!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(rows),
    } as never);
  }

  it("inserts the full body for rows that do not exist yet", async () => {
    withExistingOrgRows([]);

    await seedStatePartyOrg(db as unknown as Db, () => {}, "2019-default");

    const ops = db.collectionMocks.statePartyOrg!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { upsert?: boolean; update: { $set: Record<string, unknown> } };
    }>;
    expect(ops).toHaveLength(generateStatePartyOrg("2019-default").length);
    expect(ops[0]!.updateOne.upsert).toBe(true);
    expect(ops[0]!.updateOne.update.$set).toMatchObject({ organization: expect.any(Number) });
  });

  it("never resets built-up Org, treasury or an elected state chair", async () => {
    const seeded = generateStatePartyOrg("2019-default");
    // Every row already exists and has been played: Org built far above the
    // lean-derived baseline, money banked, a chair elected.
    withExistingOrgRows(
      seeded.map((row) => ({
        ...row,
        organization: 88,
        treasury: 2_400_000,
        chairId: "char-7001",
      }))
    );

    await seedStatePartyOrg(db as unknown as Db, () => {}, "2019-default");

    // Nothing to fill on complete rows, so no write is issued at all.
    expect(db.collectionMocks.statePartyOrg!.bulkWrite).not.toHaveBeenCalled();
  });

  it("fills only the missing field on an existing row", async () => {
    const seeded = generateStatePartyOrg("2019-default");
    withExistingOrgRows(
      seeded.map((row) => {
        const stored: Record<string, unknown> = { ...row, organization: 88, treasury: 2_400_000 };
        delete stored.consecutiveLosses;
        return stored;
      })
    );

    await seedStatePartyOrg(db as unknown as Db, () => {}, "2019-default");

    const ops = db.collectionMocks.statePartyOrg!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { upsert?: boolean; update: { $set: Record<string, unknown> } };
    }>;
    expect(ops).toHaveLength(seeded.length);
    for (const op of ops) {
      expect(Object.keys(op.updateOne.update.$set).sort()).toEqual([
        "consecutiveLosses",
        "updatedAt",
      ]);
      expect(op.updateOne.upsert).toBeUndefined();
    }
  });
});
