import { describe, it, expect, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { buildHeroImageByCrisisName, reseedCrisisHeroImages } from "./reseedCrisisHeroImages";
import { RECESSION_TEMPLATE } from "./templates";

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  db.collection("crises");
});

describe("buildHeroImageByCrisisName", () => {
  it("maps template names to hero images", () => {
    const map = buildHeroImageByCrisisName();
    expect(map.get(RECESSION_TEMPLATE.name)).toBe(RECESSION_TEMPLATE.heroImage);
  });
});

describe("reseedCrisisHeroImages", () => {
  it("updates crises missing or with stale hero images", async () => {
    const recessionId = new ObjectId();
    const manualId = new ObjectId();

    db.collectionMocks["crises"]!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: recessionId,
          name: "Recession",
          heroImage: undefined,
        },
        {
          _id: manualId,
          name: "Ship Blocks Suez Canal",
          heroImage: "https://example.com/old.jpg",
        },
      ],
    });

    const result = await reseedCrisisHeroImages(db as unknown as Db);

    expect(result.updated).toBe(1);
    expect(result.alreadyCorrect).toBe(0);
    expect(result.unmatched).toEqual(["Ship Blocks Suez Canal"]);
    expect(db.collectionMocks["crises"]!.updateOne).toHaveBeenCalledWith(
      { _id: recessionId },
      { $set: { heroImage: RECESSION_TEMPLATE.heroImage } }
    );
  });

  it("skips crises that already have the correct image", async () => {
    db.collectionMocks["crises"]!.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          name: "Recession",
          heroImage: RECESSION_TEMPLATE.heroImage,
        },
      ],
    });

    const result = await reseedCrisisHeroImages(db as unknown as Db);

    expect(result.updated).toBe(0);
    expect(result.alreadyCorrect).toBe(1);
    expect(db.collectionMocks["crises"]!.updateOne).not.toHaveBeenCalled();
  });
});
