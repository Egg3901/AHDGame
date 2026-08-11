import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { resolveExecutiveHolder } from "./resolveExecutiveHolder";

function partyMock(db: ReturnType<typeof createMockDb>) {
  db.collection("politicalParties").findOne.mockResolvedValue({
    _id: new ObjectId(),
    sequentialId: 6,
    name: "Social Democratic Party",
    color: "#0a0",
    countryId: "NG",
  });
}

describe("resolveExecutiveHolder", () => {
  it("returns null for a null official", async () => {
    const db = createMockDb();
    expect(await resolveExecutiveHolder(db as unknown as Db, null)).toBeNull();
  });

  it("resolves an NPP-backed official (isNPP true, npp profile fields)", async () => {
    const db = createMockDb();
    const nppId = new ObjectId();
    db.collection("npps").findOne.mockResolvedValue({
      _id: nppId,
      sequentialId: 42,
      name: "Dapo Olatunji",
      party: "6",
      countryId: "NG",
    });
    partyMock(db);
    const holder = await resolveExecutiveHolder(
      db as unknown as Db,
      {
        _id: new ObjectId(),
        countryId: "NG",
        officeType: "president",
        nppId,
        characterId: null,
        electedAt: new Date("2005-01-01"),
      } as never
    );
    expect(holder).toMatchObject({
      isNPP: true,
      characterName: "Dapo Olatunji",
      sequentialId: 42,
      partyName: "Social Democratic Party",
      countryId: "NG",
    });
    expect(holder!.id).toBe(nppId.toString());
    expect(holder!.characterId).toBe("");
  });

  it("resolves a character-backed official (isNPP false)", async () => {
    const db = createMockDb();
    const charId = new ObjectId();
    db.collection("characters").findOne.mockResolvedValue({
      _id: charId,
      sequentialId: 7,
      name: "Jane Doe",
      party: "6",
      countryId: "NG",
    });
    partyMock(db);
    const holder = await resolveExecutiveHolder(
      db as unknown as Db,
      {
        _id: new ObjectId(),
        countryId: "NG",
        officeType: "president",
        characterId: charId,
        electedAt: new Date("2005-01-01"),
      } as never
    );
    expect(holder).toMatchObject({
      isNPP: false,
      characterName: "Jane Doe",
      sequentialId: 7,
      partyName: "Social Democratic Party",
    });
    expect(holder!.id).toBe(charId.toString());
    expect(holder!.characterId).toBe(charId.toString());
  });

  it("returns null when the referenced character no longer exists", async () => {
    const db = createMockDb();
    // characters.findOne defaults to null in the mock.
    const holder = await resolveExecutiveHolder(
      db as unknown as Db,
      {
        _id: new ObjectId(),
        countryId: "NG",
        officeType: "president",
        characterId: new ObjectId(),
        electedAt: new Date(),
      } as never
    );
    expect(holder).toBeNull();
  });
});
