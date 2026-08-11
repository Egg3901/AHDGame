import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getOfficeHolderRow, getCurrentOfficeHolder, getOfficeState } from "./queries";

describe("getOfficeHolderRow", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("queries electedOfficials with governor officeType for US", async () => {
    const charId = new ObjectId();
    const row = {
      _id: new ObjectId(),
      officeType: "governor",
      state: "TX",
      characterId: charId,
      countryId: "US",
    };
    db.collection("electedOfficials").findOne.mockResolvedValue(row);

    const result = await getOfficeHolderRow(db as unknown as Db, "US", "tx", charId);
    expect(result).toBe(row);
    expect(db.collection("electedOfficials").findOne).toHaveBeenCalledWith({
      officeType: "governor",
      state: "TX",
      characterId: charId,
      countryId: "US",
    });
  });

  it("queries with ministerPresident officeType for DE", async () => {
    const charId = new ObjectId();
    db.collection("electedOfficials").findOne.mockResolvedValue(null);

    await getOfficeHolderRow(db as unknown as Db, "DE", "BY", charId);
    expect(db.collection("electedOfficials").findOne).toHaveBeenCalledWith(
      expect.objectContaining({ officeType: "ministerPresident", state: "BY", countryId: "DE" })
    );
  });

  it("returns null when no row matches", async () => {
    db.collection("electedOfficials").findOne.mockResolvedValue(null);
    const result = await getOfficeHolderRow(db as unknown as Db, "US", "tx", new ObjectId());
    expect(result).toBeNull();
  });
});

describe("getCurrentOfficeHolder", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("queries without characterId filter", async () => {
    db.collection("electedOfficials").findOne.mockResolvedValue(null);
    await getCurrentOfficeHolder(db as unknown as Db, "US", "tx");
    expect(db.collection("electedOfficials").findOne).toHaveBeenCalledWith({
      officeType: "governor",
      state: "TX",
      countryId: "US",
    });
  });
});

describe("getOfficeState", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("returns the office-state doc when one exists", async () => {
    const doc = {
      countryId: "US",
      stateId: "TX",
      characterId: new ObjectId(),
      characterName: "J. Smith",
      gubernatorialActions: 2,
      lastActionGrantedTurn: 42,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.collection("governorOfficeState").findOne.mockResolvedValue(doc);
    const state = await getOfficeState(db as unknown as Db, "US", "TX");
    expect(state).toBe(doc);
  });

  it("returns null when no doc exists", async () => {
    db.collection("governorOfficeState").findOne.mockResolvedValue(null);
    expect(await getOfficeState(db as unknown as Db, "US", "TX")).toBeNull();
  });
});
