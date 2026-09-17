import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  DUPLICATE_SOVEREIGN_ISSUER_REPAIRS,
  migration,
  repairDuplicateCorporationSequentialIds,
} from "./2026-09-17-repair-duplicate-corporation-sequential-ids";

const run = (db: MockDb, dryRun = false) =>
  repairDuplicateCorporationSequentialIds(db as unknown as Db, { dryRun });

// A corrupted 1953 world: the eight sovereign issuers on their pre-fix ids,
// the canonical holders (RU/DD/market block) on theirs.
function corruptedWorldDocs() {
  const docs: Array<{ _id: ObjectId; sequentialId: number; name: string; countryId: string }> = [];
  const oldIds = [900_009, 900_010, 900_011, 900_012, 900_013, 900_014, 900_015, 900_016];
  DUPLICATE_SOVEREIGN_ISSUER_REPAIRS.forEach((row, i) => {
    docs.push({
      _id: new ObjectId(row.oidHex),
      sequentialId: oldIds[i]!,
      name: row.name,
      countryId: row.countryId,
    });
  });
  docs.push(
    {
      _id: new ObjectId("700000000000000000000081"),
      sequentialId: 900_009,
      name: "Soviet Union",
      countryId: "RU",
    },
    {
      _id: new ObjectId("7000000000000000000000a1"),
      sequentialId: 900_011,
      name: "Regie",
      countryId: "FR",
    }
  );
  return docs;
}

function setupInMemory(
  docs: Array<{ _id: ObjectId; sequentialId: number; name: string; countryId: string }>
) {
  const db = createMockDb() as unknown as MockDb;
  const store = new Map(docs.map((d) => [String(d._id), { ...d }]));
  const corps = db.collectionMocks.corporations ?? db.collection("corporations");

  corps.findOne.mockImplementation(async (filter: { _id: ObjectId }) => {
    const doc = store.get(String(filter._id));
    return doc ? { ...doc } : null;
  });
  corps.updateOne.mockImplementation(
    async (filter: { _id: ObjectId }, update: { $set: { sequentialId: number } }) => {
      const doc = store.get(String(filter._id));
      if (!doc) return { modifiedCount: 0, matchedCount: 0 };
      doc.sequentialId = update.$set.sequentialId;
      return { modifiedCount: 1, matchedCount: 1 };
    }
  );
  corps.find.mockImplementation(() => ({
    toArray: async () => [...store.values()].map((d) => ({ ...d })),
  }));
  return { db, corps, store };
}

describe("sovereign issuer repair table (issue #2028)", () => {
  it("covers exactly FR/IT/ES/SE/TR/GR/AT/FI in seed order on 900_019-900_026", () => {
    expect(DUPLICATE_SOVEREIGN_ISSUER_REPAIRS.map((r) => r.countryId)).toEqual([
      "FR",
      "IT",
      "ES",
      "SE",
      "TR",
      "GR",
      "AT",
      "FI",
    ]);
    expect(DUPLICATE_SOVEREIGN_ISSUER_REPAIRS.map((r) => r.sequentialId)).toEqual([
      900_019, 900_020, 900_021, 900_022, 900_023, 900_024, 900_025, 900_026,
    ]);
  });

  it("derives the same deterministic _ids as the seed module formula", () => {
    // budgets.ts: oid `00000000000000000000a${(index * 3 + 1).toString(16).padStart(3, "0")}`
    DUPLICATE_SOVEREIGN_ISSUER_REPAIRS.forEach((row, index) => {
      const expected = `00000000000000000000a${(index * 3 + 1).toString(16).padStart(3, "0")}`;
      expect(row.oidHex).toBe(expected);
      expect(() => new ObjectId(row.oidHex)).not.toThrow();
    });
  });

  it("is registered idempotent", () => {
    expect(migration.id).toBe("2026-09-17-repair-duplicate-corporation-sequential-ids");
    expect(migration.idempotent).toBe(true);
  });
});

describe("repairDuplicateCorporationSequentialIds", () => {
  it("renumbers all eight issuers and ensures the unique index", async () => {
    const { db, corps, store } = setupInMemory(corruptedWorldDocs());
    const result = await run(db);

    expect(result.documentsUpdated).toBe(8);
    DUPLICATE_SOVEREIGN_ISSUER_REPAIRS.forEach((row) => {
      expect(store.get(row.oidHex)?.sequentialId).toBe(row.sequentialId);
    });
    // Canonical holders untouched.
    expect(store.get("700000000000000000000081")?.sequentialId).toBe(900_009);
    expect(corps.createIndex).toHaveBeenCalledWith(
      { sequentialId: 1 },
      { unique: true, sparse: true, name: "corporations_sequentialId" }
    );
    expect(result.notes.join("\n")).toContain("8 renumbered");
  });

  it("is a no-op for updates on an already-fixed world but still ensures the index", async () => {
    const fixed = corruptedWorldDocs().map((d) => {
      const row = DUPLICATE_SOVEREIGN_ISSUER_REPAIRS.find((r) => r.oidHex === String(d._id));
      return row ? { ...d, sequentialId: row.sequentialId } : d;
    });
    const { db, corps } = setupInMemory(fixed);
    const result = await run(db);

    expect(result.documentsUpdated).toBe(0);
    expect(corps.updateOne).not.toHaveBeenCalled();
    expect(corps.createIndex).toHaveBeenCalledTimes(1);
  });

  it("writes nothing on dryRun", async () => {
    const { db, corps, store } = setupInMemory(corruptedWorldDocs());
    const result = await run(db, true);

    expect(result.documentsUpdated).toBe(0);
    expect(corps.updateOne).not.toHaveBeenCalled();
    expect(corps.createIndex).not.toHaveBeenCalled();
    expect(store.get(DUPLICATE_SOVEREIGN_ISSUER_REPAIRS[0]!.oidHex)?.sequentialId).toBe(900_009);
    expect(result.notes.join("\n")).toContain("DRY RUN");
    // The residual scan projects the planned renumbers, so a dry run reports
    // convergence instead of tripping over the duplicates it would fix.
    expect(result.notes.join("\n")).toContain("8 renumbered");
  });

  it("fails loudly when an unexpected extra claimant survives the repair", async () => {
    const docs = corruptedWorldDocs();
    docs.push({
      _id: new ObjectId("70000000000000000000ffff"),
      sequentialId: 900_019,
      name: "Squatter Corp",
      countryId: "US",
    });
    const { db, corps } = setupInMemory(docs);

    await expect(run(db)).rejects.toThrow(/900019.*Squatter Corp|Squatter Corp.*900019/s);
    expect(corps.createIndex).not.toHaveBeenCalled();
  });

  it("skips issuers absent from the world (other presets)", async () => {
    const { db, corps } = setupInMemory([
      {
        _id: new ObjectId("700000000000000000000011"),
        sequentialId: 900_001,
        name: "United States",
        countryId: "US",
      },
    ]);
    const result = await run(db);

    expect(result.documentsUpdated).toBe(0);
    expect(corps.createIndex).toHaveBeenCalledTimes(1);
    expect(result.notes.join("\n")).toContain("8 absent");
  });
});
