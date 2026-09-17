import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { MINISTERIAL_ACTION_CAP } from "@/lib/constants/cabinetMechanicsTypes";
import { MIGRATIONS } from "../registry";
import {
  migration,
  UK_DUAL_MINISTRY_ROLE_SLOT_INDEX,
} from "./2026-09-17-uk-dual-ministry-role-slot";

interface RowDoc {
  _id: ObjectId;
  countryId: string;
  positionId: string;
  characterId: ObjectId | null;
  ministerialActions?: number;
  lastMinisterialActionResetDay?: string;
  roleSlot?: "departmental" | "central";
}

function mockMembers(rows: RowDoc[]) {
  const db = createMockDb();
  db.collection("cabinetMembers");
  db.collection("characters");
  db.collectionMocks.cabinetMembers!.find.mockReturnValue({
    project: () => ({
      toArray: async () => rows,
    }),
  } as never);
  // attach dropIndex: the shared mock factory has no dropIndex mock
  (db.collectionMocks.cabinetMembers as unknown as Record<string, unknown>).dropIndex = vi
    .fn()
    .mockResolvedValue(undefined);
  return db;
}

describe("uk dual-ministry migration registration", () => {
  it("is registered as an idempotent migration", () => {
    const entry = MIGRATIONS.find((m) => m.id === migration.id);
    expect(entry).toBeDefined();
    expect(entry!.idempotent).toBe(true);
    expect(migration.idempotent).toBe(true);
  });
});

describe("uk dual-ministry migration dry-run", () => {
  it("reports the plan and performs no writes", async () => {
    const holder = new ObjectId();
    const db = mockMembers([
      { _id: new ObjectId(), countryId: "UK", positionId: "chancellor", characterId: holder },
      {
        _id: new ObjectId(),
        countryId: "UK",
        positionId: "deputy_prime_minister",
        characterId: holder,
      },
    ]);

    const result = await migration.execute(db as unknown as Db, { dryRun: true });

    expect(result.documentsScanned).toBe(2);
    expect(result.documentsDeleted ?? 0).toBe(0);
    expect(result.notes?.join(" ")).toContain("dry run");
    expect(result.notes?.join(" ")).toContain("no writes performed");
    expect(db.collectionMocks.cabinetMembers!.updateMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.cabinetMembers!.createIndex).not.toHaveBeenCalled();
  });
});

describe("uk dual-ministry migration apply", () => {
  it("classifies slots, inits the min-balance pool, swaps the index, deletes nothing", async () => {
    const holder = new ObjectId();
    const db = mockMembers([
      {
        _id: new ObjectId(),
        countryId: "UK",
        positionId: "chancellor",
        characterId: holder,
        ministerialActions: 3,
        lastMinisterialActionResetDay: "2026-09-17",
      },
      {
        _id: new ObjectId(),
        countryId: "UK",
        positionId: "deputy_prime_minister",
        characterId: holder,
        ministerialActions: 1,
        lastMinisterialActionResetDay: "2026-09-16",
      },
      // NPP-held seat: classified, never pooled
      { _id: new ObjectId(), countryId: "UK", positionId: "home_secretary", characterId: null },
    ]);
    db.collectionMocks.cabinetMembers!.updateMany.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.characters!.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    // two classification updates: one central, one departmental
    expect(db.collectionMocks.cabinetMembers!.updateMany).toHaveBeenCalledTimes(2);
    // shared pool starts from the minimum remaining row, never the max
    const poolCall = db.collectionMocks.characters!.updateOne.mock.calls[0]!;
    expect(poolCall[0]).toMatchObject({
      sharedMinisterialActions: { $exists: false },
    });
    expect(poolCall[1]).toMatchObject({
      $set: expect.objectContaining({ sharedMinisterialActions: 1 }),
    });
    // replacement index is created before the legacy one is dropped
    const createOrder = db.collectionMocks.cabinetMembers!.createIndex.mock.invocationCallOrder[0]!;
    const dropMock = (
      db.collectionMocks.cabinetMembers as unknown as {
        dropIndex: { mock: { invocationCallOrder: number[] } };
      }
    ).dropIndex;
    expect(db.collectionMocks.cabinetMembers!.createIndex).toHaveBeenCalledWith(
      { countryId: 1, characterId: 1, roleSlot: 1 },
      expect.objectContaining({ unique: true, name: UK_DUAL_MINISTRY_ROLE_SLOT_INDEX })
    );
    expect(dropMock.mock.invocationCallOrder[0]).toBeGreaterThan(createOrder);
    // zero deletion anywhere
    expect(result.documentsDeleted).toBe(0);
    expect(db.collectionMocks.cabinetMembers!.deleteOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.cabinetMembers!.deleteMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters!.deleteOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters!.deleteMany).not.toHaveBeenCalled();
    expect(result.notes?.join(" ")).toContain("no appointments deleted");
  });

  it("reads legacy rows missing action fields as a full-cap pool", async () => {
    const holder = new ObjectId();
    const db = mockMembers([
      { _id: new ObjectId(), countryId: "UK", positionId: "chancellor", characterId: holder },
    ]);
    db.collectionMocks.cabinetMembers!.updateMany.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.characters!.updateOne.mockResolvedValue({ modifiedCount: 1 });

    await migration.execute(db as unknown as Db, { dryRun: false });

    const poolCall = db.collectionMocks.characters!.updateOne.mock.calls[0]!;
    expect(poolCall[1]).toMatchObject({
      $set: expect.objectContaining({ sharedMinisterialActions: MINISTERIAL_ACTION_CAP }),
    });
  });

  it("is idempotent: classified rows and existing pools are left untouched", async () => {
    const holder = new ObjectId();
    const db = mockMembers([
      {
        _id: new ObjectId(),
        countryId: "UK",
        positionId: "chancellor",
        characterId: holder,
        ministerialActions: 2,
        lastMinisterialActionResetDay: "2026-09-17",
        roleSlot: "departmental",
      },
    ]);
    db.collectionMocks.cabinetMembers!.updateMany.mockResolvedValue({ modifiedCount: 0 });
    // guarded filter matches nothing because the pool already exists
    db.collectionMocks.characters!.updateOne.mockResolvedValue({ modifiedCount: 0 });

    const first = await migration.execute(db as unknown as Db, { dryRun: false });
    const second = await migration.execute(db as unknown as Db, { dryRun: false });

    expect(first.documentsDeleted ?? 0).toBe(0);
    expect(second.documentsDeleted ?? 0).toBe(0);
    expect(second.documentsUpdated).toBe(0);
    expect(db.collectionMocks.cabinetMembers!.deleteOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.cabinetMembers!.deleteMany).not.toHaveBeenCalled();
  });

  it("keeps the legacy index when two rows share a slot instead of deleting", async () => {
    const holder = new ObjectId();
    const db = mockMembers([
      {
        _id: new ObjectId(),
        countryId: "UK",
        positionId: "chancellor",
        characterId: holder,
        roleSlot: "departmental",
      },
      {
        _id: new ObjectId(),
        countryId: "UK",
        positionId: "home_secretary",
        characterId: holder,
        roleSlot: "departmental",
      },
    ]);
    db.collectionMocks.cabinetMembers!.updateMany.mockResolvedValue({ modifiedCount: 0 });
    db.collectionMocks.characters!.updateOne.mockResolvedValue({ modifiedCount: 0 });

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    expect(db.collectionMocks.cabinetMembers!.createIndex).not.toHaveBeenCalled();
    expect(result.documentsDeleted ?? 0).toBe(0);
    expect(result.notes?.join(" ")).toContain("index swap skipped");
  });

  it("drops nothing and keeps the legacy index when index creation fails", async () => {
    const holder = new ObjectId();
    const db = mockMembers([
      { _id: new ObjectId(), countryId: "UK", positionId: "chancellor", characterId: holder },
    ]);
    db.collectionMocks.cabinetMembers!.updateMany.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.characters!.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.cabinetMembers!.createIndex.mockRejectedValue(new Error("boom"));

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    const dropMock = (
      db.collectionMocks.cabinetMembers as unknown as { dropIndex: ReturnType<typeof vi.fn> }
    ).dropIndex;
    expect(dropMock).not.toHaveBeenCalled();
    expect(result.notes?.join(" ")).toContain("legacy index kept");
  });
});
