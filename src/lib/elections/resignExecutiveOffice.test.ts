import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { makeCharacter } from "@/lib/test-utils/factories";
import type { Db } from "mongodb";

describe("resignExecutiveOffice", () => {
  let db: MockDb;
  const now = new Date("2026-06-09T00:00:00Z");
  const characterId = new ObjectId();
  const officialId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("vacates the VP slot and clears currentOffice on the character", async () => {
    const { resignExecutiveOffice } = await import("./resignExecutiveOffice");

    await resignExecutiveOffice(
      db as unknown as Db,
      {
        _id: officialId,
        officeType: "vicePresident",
        countryId: "US",
        characterId,
        characterName: "Wilson",
        party: "1",
        isAppointment: false,
        createdAt: now,
        updatedAt: now,
      },
      makeCharacter({
        _id: characterId,
        userId: new ObjectId(),
        countryId: "US",
        name: "Wilson",
        party: "1",
        homeState: "VA",
        currentOffice: { type: "vicePresident" },
        createdAt: now,
        updatedAt: now,
      }),
      now
    );

    expect(db.collectionMocks.electedOfficials!.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ officeType: "vicePresident" }),
      expect.objectContaining({
        $set: expect.objectContaining({ characterId: null }),
      })
    );
    expect(db.collectionMocks.characters!.updateOne).toHaveBeenCalledWith(
      { _id: characterId },
      expect.objectContaining({
        $set: { currentOffice: null, updatedAt: now },
        $push: {
          careerHistory: expect.objectContaining({ type: "resigned" }),
        },
      })
    );
  });
});
