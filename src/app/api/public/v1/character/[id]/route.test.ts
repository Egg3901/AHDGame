import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/publicApi/middleware", () => ({
  publicApiGuard: vi.fn().mockResolvedValue({ ok: true, headers: {} }),
}));

describe("GET /api/public/v1/character/[id]", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    [
      "characters",
      "politicalParties",
      "states",
      "users",
      "electionCandidates",
      "elections",
      "corporations",
      "investorRankingSnapshots",
    ].forEach((n) => db.collection(n));
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { publicApiGuard } = await import("@/lib/publicApi/middleware");
    vi.mocked(publicApiGuard).mockResolvedValue({ ok: true, headers: {} });
  });

  it("returns JSON 404 when character is missing", async () => {
    db.collectionMocks.characters!.findOne.mockResolvedValue(null);
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/public/v1/character/75"), {
      params: Promise.resolve({ id: "75" }),
    });
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("returns character detail by sequentialId", async () => {
    const charId = new ObjectId();
    const userId = new ObjectId();
    db.collectionMocks.characters!.findOne.mockResolvedValue({
      _id: charId,
      userId,
      name: "Rgold",
      sequentialId: 75,
      homeState: "OH",
      countryId: "US",
      party: "independent",
    });
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.states!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "OH", name: "Ohio" }]),
    } as never);
    db.collectionMocks.users!.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.electionCandidates!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.corporations!.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    db.collectionMocks.investorRankingSnapshots!.findOne.mockResolvedValue(null);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/public/v1/character/75"), {
      params: Promise.resolve({ id: "75" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      found: true,
      character: { id: charId.toString(), name: "Rgold" },
    });
  });
});
