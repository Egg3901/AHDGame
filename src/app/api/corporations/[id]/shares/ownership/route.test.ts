import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({ resolveCorporation: vi.fn() }));

let db: MockDb;
const corpId = new ObjectId();
const holderId = new ObjectId();

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: { _id: corpId } as never,
  });
});

async function request(query = "") {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost/api/corporations/7/shares/ownership${query}`), {
    params: Promise.resolve({ id: "7" }),
  });
}

describe("public ownership history", () => {
  it("returns only ownership fields and batches departed-holder names", async () => {
    db.collection("corporationHistory");
    const history = db.collectionMocks.corporationHistory;
    history.findOne.mockResolvedValue({ turn: 200 });
    history.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          turn: 199,
          totalShares: 100,
          shareholders: [{ characterId: holderId, shares: 40, avgCostPerShare: 999 }],
          publicFloat: 60,
          income: 777,
          liquidCapital: 888,
        },
        { turn: 200, totalShares: 100, shareholders: [], publicFloat: 100 },
      ]),
    });
    db.collection("characters");
    db.collectionMocks.characters.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: holderId, name: "Former holder", userId: new ObjectId() }]),
    });
    const response = await request("?turns=24");
    const body = await response.json();
    expect(body.owners).toEqual([
      { key: `character:${holderId}`, kind: "character", name: "Former holder" },
    ]);
    expect(body.snapshots[0]).toEqual({
      turn: 199,
      totalShares: 100,
      holders: [{ key: `character:${holderId}`, shares: 40 }],
      publicFloat: 60,
    });
    expect(JSON.stringify(body)).not.toMatch(/avgCost|income|liquidCapital|userId/);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const pipeline = history.aggregate.mock.calls[0][0];
    expect(pipeline[0]).toEqual({
      $match: { corporationId: corpId, turn: { $gte: 177, $lte: 200 } },
    });
    expect(pipeline).toContainEqual({ $sort: { turn: -1, createdAt: -1, _id: -1 } });
    expect(pipeline).toContainEqual({ $group: { _id: "$turn", row: { $first: "$$ROOT" } } });
    expect(pipeline).toContainEqual({ $limit: 24 });
    expect(db.collectionMocks.characters.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.characters.find).toHaveBeenCalledWith(
      { _id: { $in: [holderId] } },
      { projection: { name: 1 } }
    );
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    expect(resolveCorporation).toHaveBeenCalledWith(db, "7", { _id: 1, totalShares: 1 });
  });

  it.each(["0", "193", "100000", "wrong", "24.5"])(
    "rejects unbounded or invalid ranges: %s",
    async (turns) => {
      expect((await request(`?turns=${turns}`)).status).toBe(400);
      expect(Object.keys(db.collectionMocks)).toEqual([]);
    }
  );

  it("returns an empty history before the first snapshot", async () => {
    expect(await (await request()).json()).toEqual({ snapshots: [], owners: [] });
  });

  it("retains missing legacy registers as unknown", async () => {
    db.collection("corporationHistory");
    db.collectionMocks.corporationHistory.findOne.mockResolvedValue({ turn: 10 });
    db.collectionMocks.corporationHistory.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ turn: 10, totalShares: 100 }]),
    });
    expect((await (await request()).json()).snapshots).toEqual([
      { turn: 10, totalShares: 100, holders: null, publicFloat: null },
    ]);
  });

  it("preserves corporation lookup failures", async () => {
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: false,
      response: new Response("missing", { status: 404 }) as never,
    });
    expect((await request()).status).toBe(404);
  });
});
