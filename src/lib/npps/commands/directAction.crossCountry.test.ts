import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));

import { applyNppDirectAction } from "./directAction";

describe("applyNppDirectAction — same-country guard", () => {
  let db: MockDb;
  let nppId: ObjectId;
  let characterId: ObjectId;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    nppId = new ObjectId();
    characterId = new ObjectId();
    db.collection("npps");
    db.collection("characters");
    db.collection("nppRelationships");
    db.collection("gameState");
    db.collection("characters").findOne.mockResolvedValue({
      _id: characterId,
      actions: 100,
      funds: 1_000_000,
      countryId: "US",
    });
    db.collection("nppRelationships").findOne.mockResolvedValue(null);
    db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 1 });
  });

  it("rejects boost_favorability when actor and NPP are in different countries", async () => {
    db.collection("npps").findOne.mockResolvedValue({
      _id: nppId,
      name: "UK Politician",
      countryId: "UK",
      favorability: 60,
      politicalInfluence: 40,
    });

    const result = await applyNppDirectAction(db as unknown as Db, {
      nppId,
      characterId,
      action: "boost_favorability",
    });

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/other countries/i);
    }
    // Cross-country reject must short-circuit before any write.
    expect(db.collectionMocks["npps"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["characters"]!.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
