import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { StatePartyOrg } from "@/lib/db/types";
import { migration } from "./2026-09-02-state-party-org-rekey";

/**
 * Store-backed mock: the migration's delete-then-insert re-key is exercised
 * against real key-collision semantics rather than a call recorder. Rows are
 * keyed by `_id` exactly as MongoDB keys them.
 */
function buildDb(rows: Array<Partial<StatePartyOrg> & { _id: string }>) {
  const db = createMockDb();
  const store = new Map<string, StatePartyOrg>(rows.map((r) => [r._id, { ...r } as StatePartyOrg]));

  db.collection("statePartyOrg");
  db.collectionMocks.statePartyOrg.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([...store.values()]),
  });
  db.collectionMocks.statePartyOrg.deleteMany.mockImplementation(
    async (filter: { _id?: { $in?: string[] } }) => {
      const ids = filter._id?.$in ?? [];
      let deleted = 0;
      for (const id of ids) if (store.delete(id)) deleted++;
      return { deletedCount: deleted };
    }
  );
  db.collectionMocks.statePartyOrg.deleteOne.mockImplementation(async (filter: { _id: string }) => {
    const existed = store.delete(filter._id);
    return { deletedCount: existed ? 1 : 0 };
  });
  db.collectionMocks.statePartyOrg.insertOne.mockImplementation(async (doc: StatePartyOrg) => {
    store.set(doc._id, doc);
    return { insertedId: doc._id };
  });
  db.collectionMocks.statePartyOrg.updateOne.mockImplementation(
    async (
      filter: { _id: string },
      update: { $setOnInsert?: Record<string, unknown> },
      options?: { upsert?: boolean }
    ) => {
      if (store.has(filter._id)) return { matchedCount: 1, modifiedCount: 0, upsertedCount: 0 };
      if (!options?.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      const doc = { _id: filter._id, ...(update.$setOnInsert ?? {}) } as StatePartyOrg;
      store.set(filter._id, doc);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }
  );
  db.collectionMocks.statePartyOrg.createIndex.mockResolvedValue("ok");

  return { db: db as unknown as Db, store };
}

describe(migration.id, () => {
  let log: string[];

  beforeEach(() => {
    log = [];
  });

  it("dry run scans and reports without writing", async () => {
    const { db } = buildDb([{ _id: "NW_7", countryId: "DD", stateId: "NW", partyId: "1" }]);
    const result = await migration.execute(db, { dryRun: true });

    expect(result.documentsDeleted).toBeUndefined();
    expect(result.notes?.join(" ")).toMatch(/dry run/i);
  });

  it("re-keys a row whose _id suffix disagrees with its partyId field", async () => {
    const { db, store } = buildDb([
      {
        _id: "NW_7",
        countryId: "DD",
        stateId: "NW",
        partyId: "1",
        organization: 36.76,
        treasury: 500,
      },
    ]);
    const result = await migration.execute(db, { dryRun: false });

    expect(store.has("NW_7")).toBe(false);
    const healed = store.get("NW_1");
    expect(healed).toBeDefined();
    expect(healed?.organization).toBe(36.76);
    expect(healed?.partyId).toBe("1");
    expect(result.documentsInserted).toBe(1);
  });

  it("re-keys a row whose stateId was fused in place (BEO into BE)", async () => {
    const { db, store } = buildDb([
      {
        _id: "BEO_1",
        countryId: "DD",
        stateId: "BE",
        partyId: "1",
        organization: 56.24,
      },
    ]);
    await migration.execute(db, { dryRun: false });

    expect(store.has("BEO_1")).toBe(false);
    expect(store.get("BE_1")?.organization).toBe(56.24);
  });

  it("re-keys both sides of a swapped pair onto their own canonical keys", async () => {
    // Live world, exactly as found: SPD's org sits on `_id NW_1` with
    // `partyId: "6"` (a drifted row: the suffix was SPD's PRE-merge seqId) and
    // SED's on `_id NW_7` with `partyId: "1"`. Each row's canonical key is
    // derived from its own fields, so SPD lands on NW_6 and SED on NW_1 —
    // fields and _id agree on every row afterwards, and nobody's numbers move.
    const { db, store } = buildDb([
      { _id: "NW_1", countryId: "DD", stateId: "NW", partyId: "6", organization: 16.03 },
      { _id: "NW_7", countryId: "DD", stateId: "NW", partyId: "1", organization: 36.76 },
    ]);
    const result = await migration.execute(db, { dryRun: false });

    expect(store.get("NW_6")?.organization).toBe(16.03);
    expect(store.get("NW_6")?.partyId).toBe("6");
    expect(store.get("NW_1")?.organization).toBe(36.76);
    expect(store.get("NW_1")?.partyId).toBe("1");
    expect(store.has("NW_7")).toBe(false);
    expect(result.documentsInserted).toBe(2);
  });

  it("removes a drifted duplicate competing for a free canonical key", async () => {
    // Two drifted rows both claiming NW_1 (both have stale _ids): the earliest
    // created wins, the other is deleted — two rows for one (state, party) is
    // the corruption this migration ends.
    const t0 = new Date("2026-08-01T00:00:00Z");
    const t1 = new Date("2026-08-02T00:00:00Z");
    const { db, store } = buildDb([
      {
        _id: "NW_3",
        countryId: "DD",
        stateId: "NW",
        partyId: "1",
        organization: 30,
        createdAt: t0,
      },
      { _id: "NW_9", countryId: "DD", stateId: "NW", partyId: "1", organization: 5, createdAt: t1 },
    ]);
    await migration.execute(db, { dryRun: false });

    expect(store.has("NW_3")).toBe(false);
    expect(store.has("NW_9")).toBe(false);
    const healed = store.get("NW_1");
    expect(healed?.organization).toBe(30);
  });

  it("leaves rows missing stateId/partyId alone", async () => {
    const { db, store } = buildDb([{ _id: "ORPHAN", countryId: "DD", organization: 9 }]);
    const result = await migration.execute(db, { dryRun: false });

    expect(store.has("ORPHAN")).toBe(true);
    expect(result.notes?.join(" ")).toMatch(/missing stateId\/partyId/);
  });

  it("is idempotent: a second run finds nothing", async () => {
    const { db } = buildDb([
      { _id: "NW_7", countryId: "DD", stateId: "NW", partyId: "1", organization: 36.76 },
    ]);
    await migration.execute(db, { dryRun: false });
    const second = await migration.execute(db, { dryRun: false });

    expect(second.documentsInserted ?? 0).toBe(0);
  });
});
