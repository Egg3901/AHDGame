import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireModerator", () => ({ requireModerator: vi.fn() }));

let db: MockDb;

function makeCluster(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: new ObjectId(),
    memberUserIds: [new ObjectId(), new ObjectId()],
    confidence: 0.8,
    size: 2,
    signalSummary: [{ type: "deviceKey_exact", count: 1, maxContribution: 0.8 }],
    roles: { operator: undefined, burners: [], associates: [] },
    topEvidence: ["Shared device key"],
    status: "open",
    updatedAt: new Date(),
    turn: 5,
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("altClusters");
  db.collection("users");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

async function mockModerator(isAdmin = false) {
  const { requireModerator } = await import("@/lib/api/requireModerator");
  vi.mocked(requireModerator).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString(), username: "mod1", isAdmin },
  } as Awaited<ReturnType<typeof requireModerator>>);
}

describe("GET /api/admin/alts/clusters", () => {
  it("returns 403 when not a moderator/admin", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as Awaited<ReturnType<typeof requireModerator>>);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/alts/clusters"));
    expect(res.status).toBe(403);
  });

  it("returns clusters ranked by confidence desc with the frozen response shape", async () => {
    await mockModerator();
    const high = makeCluster({ confidence: 0.9 });
    db.collectionMocks.altClusters.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([high]),
    });
    db.collectionMocks.users.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/alts/clusters"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.clusters).toHaveLength(1);
    expect(data.clusters[0]).toMatchObject({
      id: high._id.toString(),
      confidence: 0.9,
      size: 2,
      status: "open",
      topSignal: "deviceKey_exact",
    });
    expect(data.clusters[0].memberPreview).toEqual(
      expect.arrayContaining([expect.objectContaining({ userId: expect.any(String) })])
    );
  });

  it("rejects an invalid minConfidence", async () => {
    await mockModerator();
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/alts/clusters?minConfidence=2"));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid status filter", async () => {
    await mockModerator();
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/alts/clusters?status=bogus"));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid signal filter", async () => {
    await mockModerator();
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/admin/alts/clusters?signal=not_a_signal")
    );
    expect(res.status).toBe(400);
  });

  it("applies the status filter to the query", async () => {
    await mockModerator();
    const find = vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.altClusters.find = find;

    const { GET } = await import("./route");
    await GET(new Request("http://localhost/api/admin/alts/clusters?status=confirmed"));
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ status: "confirmed" }));
  });
});
