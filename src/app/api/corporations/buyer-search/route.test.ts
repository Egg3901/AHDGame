import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { PLAYER_RUN_CEO_FILTER } from "@/lib/corporations/playerRunCeo";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;

function req(query: string) {
  return new Request(`http://localhost/api/corporations/buyer-search?${query}`);
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("corporations");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

describe("GET /api/corporations/buyer-search", () => {
  it("returns no results for a query shorter than 2 characters", async () => {
    const { GET } = await import("./route");
    const res = await GET(req("q=C"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ results: [] });
    expect(db.collectionMocks.corporations!.find).not.toHaveBeenCalled();
  });

  it("treats a missing ceoType as a player-run seat (ticket 1105)", async () => {
    const { GET } = await import("./route");
    await GET(req("q=Creek"));
    expect(db.collectionMocks.corporations!.find).toHaveBeenCalledWith(
      expect.objectContaining({
        countryOwnerId: { $exists: false },
        ...PLAYER_RUN_CEO_FILTER,
        name: { $regex: "Creek", $options: "i" },
      })
    );
  });

  it("returns a player-run private corp whose ceoType was never stamped", async () => {
    const creekId = new ObjectId();
    db.collectionMocks.corporations!.find.mockReturnValue({
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: creekId,
          name: "Creek Energy",
          tickerSymbol: "CREEK",
          countryId: "US",
          // founding historically omitted ceoType; Mongo equality would miss this
        },
      ]),
    });

    const { GET } = await import("./route");
    const res = await GET(req("q=Creek"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      results: [
        {
          id: creekId.toString(),
          name: "Creek Energy",
          ticker: "CREEK",
          countryId: "US",
        },
      ],
    });
  });

  it("drops state-owned matches even if they passed the Mongo filter", async () => {
    db.collectionMocks.corporations!.find.mockReturnValue({
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          name: "Creek State Power",
          tickerSymbol: "CSP",
          countryId: "US",
          countryOwnerId: "US",
          ceoType: "character",
        },
      ]),
    });

    const { GET } = await import("./route");
    const res = await GET(req("q=Creek"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ results: [] });
  });
});
