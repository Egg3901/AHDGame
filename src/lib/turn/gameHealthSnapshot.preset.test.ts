import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { collectSeatIntegrity } from "./gameHealthSnapshot";

const eraOfficials = [
  { countryId: "CS", officeType: "nationsDeputy", state: "CS_PRG" },
  { countryId: "YU", officeType: "councilDelegate", state: "YU_MKD" },
];
let db: MockDb;
beforeEach(() => {
  db = createMockDb();
  for (const name of ["seats", "electedOfficials", "gameState"]) db.collection(name);
  db.collectionMocks.seats.find.mockReturnValue({ toArray: async () => [] });
  db.collectionMocks.electedOfficials.find.mockReturnValue({ toArray: async () => eraOfficials });
});

describe("health office integrity uses the persisted world era", () => {
  it("accepts real 1991 offices that do not exist in the base country model", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      preset: "1991-default",
    });
    expect(await collectSeatIntegrity(db as unknown as Db)).toEqual({
      orphanedOfficialCount: 0,
      seatBackedSeatsWithoutOfficials: 0,
    });
  });

  it("still rejects these offices in the 1953 configuration", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      preset: "1953-default",
    });
    expect((await collectSeatIntegrity(db as unknown as Db)).orphanedOfficialCount).toBe(2);
  });

  it("still detects an unknown office beside valid era offices", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      preset: "1991-default",
    });
    db.collectionMocks.electedOfficials.find.mockReturnValue({
      toArray: async () => [
        ...eraOfficials,
        { countryId: "US", officeType: "madeUpOffice", state: "CA" },
      ],
    });
    expect((await collectSeatIntegrity(db as unknown as Db)).orphanedOfficialCount).toBe(1);
  });

  it("retains base configuration behavior for a legacy world without a preset", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue(null);
    db.collectionMocks.electedOfficials.find.mockReturnValue({
      toArray: async () => [{ countryId: "US", officeType: "governor", state: "CA" }],
    });
    expect((await collectSeatIntegrity(db as unknown as Db)).orphanedOfficialCount).toBe(0);
  });
});
