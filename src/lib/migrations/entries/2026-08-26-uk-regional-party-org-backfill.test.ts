import type { Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-08-26-uk-regional-party-org-backfill";

/**
 * The 1953 world as it stands on live: Plaid Cymru (seq 4) organised in five
 * regions, Sinn Fein (seq 5) in one, everyone else in all twelve. The regional
 * gate is gone, so the two of them need the rest of their rows.
 */
const UK_REGIONS = [
  "LON",
  "SEE",
  "SWE",
  "EAE",
  "EMI",
  "WMI",
  "YHU",
  "NWE",
  "NEE",
  "WAL",
  "SCO",
  "NIR",
];

const PC_EXISTING = ["EAE", "EMI", "SWE", "WAL", "WMI"];
const SF_EXISTING = ["NIR"];

function buildDb(preset = "1953-default") {
  const db = createMockDb();

  db.collection("gameState");
  db.collectionMocks.gameState.findOne.mockResolvedValue({ preset });

  db.collection("politicalParties");
  db.collectionMocks.politicalParties.find.mockReturnValue({
    project: () => ({
      toArray: vi.fn().mockResolvedValue([
        { name: "Labour Party", sequentialId: 1 },
        { name: "Conservative Party", sequentialId: 2 },
        { name: "Plaid Cymru", sequentialId: 4 },
        { name: "Sinn Féin", sequentialId: 5 },
        { name: "Liberal Party", sequentialId: 6 },
      ]),
    }),
  });

  const existingIds = [
    ...UK_REGIONS.map((r) => `${r}_1`),
    ...UK_REGIONS.map((r) => `${r}_2`),
    ...UK_REGIONS.map((r) => `${r}_6`),
    ...PC_EXISTING.map((r) => `${r}_4`),
    ...SF_EXISTING.map((r) => `${r}_5`),
  ];

  // Model the collection as a real store keyed by _id so the write path is
  // exercised against actual upsert semantics rather than a bare call recorder.
  const store = new Map<string, Record<string, unknown>>(
    existingIds.map((_id) => [_id, { _id, organization: _id === "EMI_4" ? 29.16 : 12 }])
  );
  const inserted: Record<string, unknown>[] = [];

  db.collection("statePartyOrg");
  db.collectionMocks.statePartyOrg.find.mockReturnValue({
    project: () => ({
      toArray: vi.fn().mockResolvedValue([...store.keys()].map((_id) => ({ _id }))),
    }),
  });
  db.collectionMocks.statePartyOrg.updateOne.mockImplementation(
    async (
      filter: { _id: string },
      update: { $setOnInsert?: Record<string, unknown> },
      options?: { upsert?: boolean }
    ) => {
      if (store.has(filter._id)) return { matchedCount: 1, modifiedCount: 0, upsertedCount: 0 };
      if (!options?.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      const doc = { _id: filter._id, ...(update.$setOnInsert ?? {}) };
      store.set(filter._id, doc);
      inserted.push(doc);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }
  );

  return { db: db as unknown as Db, inserted, store };
}

describe(migration.id, () => {
  it("dry run reports the gap without writing", async () => {
    const { db, inserted } = buildDb();
    const result = await migration.execute(db, { dryRun: true });

    expect(result.documentsInserted ?? 0).toBe(0);
    expect(inserted).toHaveLength(0);
    expect(result.notes?.join(" ")).toMatch(/dry run/i);
  });

  it("inserts exactly the missing rows for the formerly-regional parties", async () => {
    const { db, inserted } = buildDb();
    const result = await migration.execute(db, { dryRun: false });

    const ids = inserted.map((d) => d._id as string).sort();
    const expected = [
      ...UK_REGIONS.filter((r) => !PC_EXISTING.includes(r)).map((r) => `${r}_4`),
      ...UK_REGIONS.filter((r) => !SF_EXISTING.includes(r)).map((r) => `${r}_5`),
    ].sort();

    expect(ids).toEqual(expected);
    expect(result.documentsInserted).toBe(expected.length);
  });

  it("never overwrites org a party already built outside its historic home", async () => {
    const { db, inserted, store } = buildDb();
    await migration.execute(db, { dryRun: false });

    // EMI_4 carries 29.16 org on live from player Build Org actions. It is an
    // existing row, so the backfill must leave its value exactly as it was.
    expect(inserted.map((d) => d._id)).not.toContain("EMI_4");
    expect(store.get("EMI_4")?.organization).toBe(29.16);
  });

  // The runner executes on deploy, which can overlap a turn. Build Org can
  // create the very row being backfilled in between the scan and the write, so
  // the write must not be a bare insert that would abort the run on E11000.
  it("does not clobber or fail on a row that appears after the scan", async () => {
    const { db, inserted, store } = buildDb();

    // The scan snapshots the key set at build time, so adding LON_4 now models
    // a row created by a concurrent turn after the scan but before the write.
    store.set("LON_4", { _id: "LON_4", organization: 41 });

    const result = await migration.execute(db, { dryRun: false });

    expect(store.get("LON_4")?.organization).toBe(41);
    expect(inserted.map((d) => d._id)).not.toContain("LON_4");
    expect(result.documentsInserted).toBe(17);
  });

  it("seeds the new rows on the minimum-org floor, not at parity", async () => {
    const { db, inserted } = buildDb();
    await migration.execute(db, { dryRun: false });

    const london = inserted.find((d) => d._id === "LON_4");
    expect(london).toBeDefined();
    // Plaid polled 0 in London in 1951, so it lands on the floor with a zero
    // registration share — present and organisable, not competitive.
    expect(london!.organization).toBe(5);
    expect(london!.registrationShare).toBe(0);
    expect(london!.hasPresence).toBe(true);
  });

  it("is a no-op on a world that already has every row", async () => {
    const { db, inserted, store } = buildDb();
    for (const r of UK_REGIONS)
      for (const p of [1, 2, 4, 5, 6]) store.set(`${r}_${p}`, { _id: `${r}_${p}` });

    const result = await migration.execute(db, { dryRun: false });
    expect(result.documentsInserted).toBe(0);
    expect(inserted).toHaveLength(0);
  });
});
