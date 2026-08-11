import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { resolveConflict } from "./resolveConflict";

const conflict = {
  _id: "afghan",
  name: "Central Asian Front",
  hostCountry: "RU",
  region: "cas",
  type: "interstate",
  sideA: { label: "NATO", countries: ["US", "UK"], kind: "coalition", backer: "west" },
  sideB: { label: "Warsaw Pact", countries: ["RU"], kind: "coalition", backer: "east" },
  bloc: "contested",
  terrain: "Arid / mountainous",
  severity: "HIGH",
  baseStrength: 470,
  supplyA: 65,
  supplyB: 55,
  terr: 1.15,
  infra: 34,
  enemyMix: ["armor"],
  intensity: 70,
  control: 0,
  controlStart: 100,
  status: "active",
  createdBy: "player",
  startTurn: 1,
} as unknown as ConflictDoc;

describe("resolveConflict", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("conflicts");
    db.collection("militaryFormations");
    db.collection("militaryUnits");
    db.collectionMocks.militaryUnits.find.mockReturnValue({
      project: () => ({ toArray: vi.fn().mockResolvedValue([]) }),
    });
  });

  it("records the outcome on the conflict", async () => {
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue(null);

    await resolveConflict(db as unknown as Db, conflict, "A", 42);

    const [filter, update] = db.collectionMocks.conflicts.updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: "afghan" });
    expect(update.$set).toMatchObject({ status: "resolved", endTurn: 42 });
    expect(update.$set.outcome.winner).toBe("A");
    expect(typeof update.$set.outcome.note).toBe("string");
  });

  it("drops this theater's postings for every belligerent, keeping the others", async () => {
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue({
      countryId: "US",
      conflictAssignments: [
        { theaterId: "afghan", generalCharacterId: "char_1", inCharge: true },
        { theaterId: "korea", generalCharacterId: "char_2", inCharge: false },
      ],
      positions: {},
    });

    await resolveConflict(db as unknown as Db, conflict, "A", 42);

    // Three belligerents: US, UK, RU.
    expect(db.collectionMocks.militaryFormations.updateOne).toHaveBeenCalledTimes(3);
    const [, update] = db.collectionMocks.militaryFormations.updateOne.mock.calls[0];
    expect(update.$set.conflictAssignments).toEqual([
      { theaterId: "korea", generalCharacterId: "char_2", inCharge: false },
    ]);
  });

  it("does not write formations for a belligerent with nothing posted here", async () => {
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue({
      countryId: "US",
      conflictAssignments: [{ theaterId: "korea", generalCharacterId: "char_2", inCharge: false }],
      positions: {},
    });

    await resolveConflict(db as unknown as Db, conflict, "A", 42);

    expect(db.collectionMocks.militaryFormations.updateOne).not.toHaveBeenCalled();
  });

  // The posting is what must go: `unit.theaterId` is a reconciled cache of
  // theaterOfUnit(assignedGeneralId, assignments), so clearing it alone would be
  // undone by the next reconcile and park the units at a dead theater.
  it("returns units at the dead theater to reserve", async () => {
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue({
      countryId: "US",
      conflictAssignments: [{ theaterId: "afghan", generalCharacterId: "char_1", inCharge: true }],
      positions: {},
    });
    const unitId = new ObjectId();
    db.collectionMocks.militaryUnits.find.mockReturnValue({
      project: () => ({
        toArray: vi
          .fn()
          .mockResolvedValue([
            { _id: unitId, theaterId: "afghan", assignedGeneralId: "char_1", posture: "standard" },
          ]),
      }),
    });

    await resolveConflict(db as unknown as Db, conflict, "A", 42);

    const ops = db.collectionMocks.militaryUnits.bulkWrite.mock.calls.flatMap((c) => c[0]);
    expect(ops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          updateOne: expect.objectContaining({
            update: { $set: expect.objectContaining({ theaterId: "reserve" }) },
          }),
        }),
      ])
    );
  });

  it("visits each belligerent country exactly once", async () => {
    const dup = {
      ...conflict,
      sideA: { ...conflict.sideA, countries: ["US", "US", "UK"] },
    } as unknown as ConflictDoc;
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue(null);

    await resolveConflict(db as unknown as Db, dup, "A", 42);

    expect(db.collectionMocks.militaryFormations.findOne).toHaveBeenCalledTimes(3);
  });

  it("names the winning side in the outcome note", async () => {
    db.collectionMocks.militaryFormations.findOne.mockResolvedValue(null);

    await resolveConflict(db as unknown as Db, conflict, "B", 42);

    const [, update] = db.collectionMocks.conflicts.updateOne.mock.calls[0];
    expect(update.$set.outcome.note).toContain("Warsaw Pact");
  });
});
