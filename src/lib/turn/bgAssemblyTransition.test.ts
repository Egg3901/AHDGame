import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { bgRegions1991 } from "@/lib/countries/bg/data/bgRegions1991";
import {
  BG_ORDINARY_ASSEMBLY_SEATS,
  bgAssemblyName,
  bgElectionSeatsForPreset,
  canOpenBgOrdinaryAssembly,
} from "@/lib/countries/bg/rules/assemblyTransition";
import { processBgAssemblyTransition } from "./bgAssemblyTransition";

function cursorOf<T>(docs: T[]) {
  return { toArray: vi.fn().mockResolvedValue(docs) };
}

function readyDb() {
  const db = createMockDb();
  db.collection("countryGameStates").findOne.mockResolvedValue({ _id: "BG" });
  db.collection("states").find.mockReturnValue(cursorOf(bgRegions1991));
  db.collection("elections").find.mockReturnValue(
    cursorOf(
      Object.entries(BG_ORDINARY_ASSEMBLY_SEATS).map(([state, totalSeats]) => ({
        state,
        totalSeats,
      }))
    )
  );
  return db;
}

describe("1991 Bulgarian ordinary Assembly transition", () => {
  it("apportions exactly 240 seats and requires the full resolved slate in November", () => {
    expect(bgAssemblyName("1991-default", undefined)).toBe("Grand National Assembly");
    expect(bgAssemblyName("1991-default", 41)).toBe("National Assembly");
    expect(bgAssemblyName("1979-default", undefined)).toBe("National Assembly");
    expect(Object.values(BG_ORDINARY_ASSEMBLY_SEATS).reduce((sum, seats) => sum + seats, 0)).toBe(
      240
    );
    expect(canOpenBgOrdinaryAssembly(40, BG_ORDINARY_ASSEMBLY_SEATS)).toBe(false);
    expect(canOpenBgOrdinaryAssembly(41, BG_ORDINARY_ASSEMBLY_SEATS)).toBe(true);
    const missing = { ...BG_ORDINARY_ASSEMBLY_SEATS };
    delete missing[Object.keys(missing)[0]!];
    expect(canOpenBgOrdinaryAssembly(41, missing)).toBe(false);
    const startSeats = Object.fromEntries(
      bgRegions1991.map((region) => [region._id, region.houseDistricts])
    );
    expect(
      Object.values(bgElectionSeatsForPreset(startSeats, "1991-default", true)).reduce(
        (a, b) => a + b,
        0
      )
    ).toBe(400);
    expect(
      Object.values(bgElectionSeatsForPreset(startSeats, "1991-default", false)).reduce(
        (a, b) => a + b,
        0
      )
    ).toBe(240);
    expect(bgElectionSeatsForPreset(startSeats, "1979-default", false)).toEqual(startSeats);
  });

  it("changes every region and majority before recording the durable marker", async () => {
    const db = readyDb();
    const writes: string[] = [];
    db.collection("states").bulkWrite.mockImplementation(async () => {
      writes.push("regions");
    });
    db.collection("governmentFormations").updateOne.mockImplementation(async () => {
      writes.push("formation");
    });
    db.collection("countryGameStates").updateOne.mockImplementation(async () => {
      writes.push("marker");
    });
    expect(
      await processBgAssemblyTransition(
        db as unknown as Db,
        { preset: "1991-default" },
        41,
        new Date()
      )
    ).toBe(true);
    expect(writes).toEqual(["regions", "formation", "marker"]);
    const ops = db.collectionMocks.states.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { filter: { _id: string }; update: { $set: { houseDistricts: number } } };
    }>;
    expect(ops).toHaveLength(5);
    expect(ops.reduce((sum, op) => sum + op.updateOne.update.$set.houseDistricts, 0)).toBe(240);
    expect(db.collectionMocks.governmentFormations.updateOne.mock.calls[0]![1].$set).toMatchObject({
      totalSeats: 240,
      majorityThreshold: 121,
    });
    expect(db.collectionMocks.countryGameStates.updateOne.mock.calls[0]![1].$set).toMatchObject({
      bgOrdinaryAssemblySinceTurn: 41,
    });
  });

  it("waits for election resolution and the unpinned calendar", async () => {
    const db = readyDb();
    db.collection("elections").find.mockReturnValue(cursorOf([]));
    expect(
      await processBgAssemblyTransition(
        db as unknown as Db,
        { preset: "1991-default" },
        41,
        new Date()
      )
    ).toBe(false);
    expect(db.collectionMocks.states.bulkWrite).not.toHaveBeenCalled();

    const frozen = readyDb();
    expect(
      await processBgAssemblyTransition(
        frozen as unknown as Db,
        { preset: "1991-default", preIteration: { active: true } },
        100,
        new Date()
      )
    ).toBe(false);
    expect(frozen.collectionMocks.states.bulkWrite).not.toHaveBeenCalled();
  });

  it("does not repeat after the marker or in another preset", async () => {
    const db = readyDb();
    db.collection("countryGameStates").findOne.mockResolvedValue({
      _id: "BG",
      bgOrdinaryAssemblySinceTurn: 41,
    });
    expect(
      await processBgAssemblyTransition(
        db as unknown as Db,
        { preset: "1991-default" },
        42,
        new Date()
      )
    ).toBe(false);
    expect(db.collectionMocks.states.bulkWrite).not.toHaveBeenCalled();

    const coldWar = readyDb();
    expect(
      await processBgAssemblyTransition(
        coldWar as unknown as Db,
        { preset: "1979-default" },
        41,
        new Date()
      )
    ).toBe(false);
    expect(coldWar.collectionMocks.states.bulkWrite).not.toHaveBeenCalled();
  });

  it("keeps the marker clear when an earlier seat write fails", async () => {
    const db = readyDb();
    db.collection("states").bulkWrite.mockRejectedValue(new Error("write failed"));
    await expect(
      processBgAssemblyTransition(db as unknown as Db, { preset: "1991-default" }, 41, new Date())
    ).rejects.toThrow("write failed");
    expect(db.collectionMocks.countryGameStates.updateOne).not.toHaveBeenCalled();
  });
});
