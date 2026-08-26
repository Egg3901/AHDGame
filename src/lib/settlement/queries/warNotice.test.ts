import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

const frozen = (over: Record<string, unknown> = {}) => ({
  _id: new ObjectId(),
  status: "frozen",
  conflictId: "war_us_dd_412",
  ...over,
});

describe("loadGermanQuestionWarNotice", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    prime(db, "gameState").findOne.mockResolvedValue({
      _id: "current",
      settlementCrisisEnabled: true,
    });
    prime(db, "conflicts").findOne.mockResolvedValue({
      _id: "war_us_dd_412",
      conflictId: 57,
      name: "The War for Germany",
    });
  });

  it("says nothing when no crisis is frozen", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(null);
    const { loadGermanQuestionWarNotice } = await import("./warNotice");
    expect(await loadGermanQuestionWarNotice(db as unknown as Db)).toBeNull();
  });

  it("names the war a crisis attached itself to", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(
      frozen({
        conflictAttachment: {
          anchor: "DD",
          previousName: "United States vs East Germany",
          previousHostEntities: null,
        },
      })
    );
    const { loadGermanQuestionWarNotice } = await import("./warNotice");
    const notice = await loadGermanQuestionWarNotice(db as unknown as Db);
    expect(notice).toEqual({ conflictNumber: 57, name: "The War for Germany", attached: true });
  });

  it("marks a crisis frozen by its own declaration as not attached", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(frozen());
    const { loadGermanQuestionWarNotice } = await import("./warNotice");
    const notice = await loadGermanQuestionWarNotice(db as unknown as Db);
    expect(notice?.attached).toBe(false);
  });

  it("survives a war that has gone missing, without inventing a link", async () => {
    prime(db, "settlementCrises").findOne.mockResolvedValue(frozen());
    prime(db, "conflicts").findOne.mockResolvedValue(null);
    const { loadGermanQuestionWarNotice } = await import("./warNotice");
    const notice = await loadGermanQuestionWarNotice(db as unknown as Db);
    expect(notice).toEqual({ conflictNumber: null, name: "the war", attached: false });
  });

  it("says nothing while the feature is switched off", async () => {
    prime(db, "gameState").findOne.mockResolvedValue({
      _id: "current",
      settlementCrisisEnabled: false,
    });
    prime(db, "settlementCrises").findOne.mockResolvedValue(frozen());
    const { loadGermanQuestionWarNotice } = await import("./warNotice");
    expect(await loadGermanQuestionWarNotice(db as unknown as Db)).toBeNull();
    expect(prime(db, "settlementCrises").findOne).not.toHaveBeenCalled();
  });
});
