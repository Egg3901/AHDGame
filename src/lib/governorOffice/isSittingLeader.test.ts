import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { isSittingLeader } from "./isSittingLeader";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

function mockDb() {
  const db = createMockDb();
  // Collection mocks materialize on first access.
  for (const name of [
    "countryState",
    "electedOfficials",
    "governmentFormations",
    "parliamentaryGovernments",
  ]) {
    db.collection(name);
  }
  return { db, collectionMocks: db.collectionMocks };
}

describe("isSittingLeader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recognizes the seated US president", async () => {
    const presidentId = new ObjectId();
    const { db, collectionMocks } = mockDb();
    collectionMocks["countryState"]!.findOne.mockResolvedValue({
      _id: "US",
      governmentType: "presidential",
    });
    collectionMocks["electedOfficials"]!.findOne.mockResolvedValue({
      countryId: "US",
      officeType: "president",
      characterId: presidentId,
    });

    await expect(isSittingLeader(db as never, "US", presidentId)).resolves.toBe(true);
    await expect(isSittingLeader(db as never, "US", new ObjectId())).resolves.toBe(false);
  });

  it("recognizes a parliamentary PM from the canonical formation", async () => {
    const pmId = new ObjectId();
    const { db, collectionMocks } = mockDb();
    collectionMocks["countryState"]!.findOne.mockResolvedValue({
      _id: "UK",
      governmentType: "parliamentary",
    });
    collectionMocks["governmentFormations"]!.findOne.mockResolvedValue({
      _id: "UK",
      pmCharacterId: pmId,
    });

    await expect(isSittingLeader(db as never, "UK", pmId)).resolves.toBe(true);
    await expect(isSittingLeader(db as never, "UK", new ObjectId())).resolves.toBe(false);
  });

  it("falls back to the legacy parliamentary record without a formation", async () => {
    const pmId = new ObjectId();
    const { db, collectionMocks } = mockDb();
    collectionMocks["countryState"]!.findOne.mockResolvedValue({
      _id: "UK",
      governmentType: "parliamentary",
    });
    collectionMocks["governmentFormations"]!.findOne.mockResolvedValue(null);
    collectionMocks["parliamentaryGovernments"]!.findOne.mockResolvedValue({
      _id: "UK",
      pmCharacterId: pmId,
    });

    await expect(isSittingLeader(db as never, "UK", pmId)).resolves.toBe(true);
  });

  it("returns false when no leader record exists", async () => {
    const { db, collectionMocks } = mockDb();
    collectionMocks["countryState"]!.findOne.mockResolvedValue({
      _id: "UK",
      governmentType: "parliamentary",
    });
    collectionMocks["governmentFormations"]!.findOne.mockResolvedValue(null);
    collectionMocks["parliamentaryGovernments"]!.findOne.mockResolvedValue(null);

    await expect(isSittingLeader(db as never, "UK", new ObjectId())).resolves.toBe(false);
  });
});
