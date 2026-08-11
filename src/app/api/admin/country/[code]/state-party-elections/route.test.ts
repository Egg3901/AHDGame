import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));

describe("GET /api/admin/country/[code]/state-party-elections", () => {
  let db: MockDb;

  const chainFind = (docs: unknown[]) =>
    vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(docs),
    });

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, admin: { username: "a" } } as never);
    const { getGameTime } = await import("@/lib/time/gameTime");
    vi.mocked(getGameTime).mockResolvedValue({
      currentTurn: 34,
      effectiveNow: new Date(),
    } as never);

    db.collection("politicalParties");
    db.collection("statePartyElections");
    db.collection("nationalPartyElections");
    db.collection("nationalCommitteeElections");
    db.collectionMocks.politicalParties.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.statePartyElections.find = chainFind([]);
    db.collectionMocks.nationalPartyElections.find = chainFind([]);
    db.collectionMocks.nationalCommitteeElections.find = chainFind([]);
  });

  it("code 'all' returns 200 and queries national/committee with no country scope", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://x/api/admin/country/all/state-party-elections?status=voting&type=all"),
      { params: Promise.resolve({ code: "all" }) }
    );

    expect(res.status).toBe(200);
    expect(db.collectionMocks.nationalPartyElections.find).toHaveBeenCalledWith({
      status: "voting",
    });
    expect(db.collectionMocks.nationalCommitteeElections.find).toHaveBeenCalledWith({
      status: "voting",
    });
  });

  it("a specific country still scopes the national query to that country", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      new Request(
        "http://x/api/admin/country/us/state-party-elections?status=voting&type=national"
      ),
      { params: Promise.resolve({ code: "us" }) }
    );

    expect(res.status).toBe(200);
    expect(db.collectionMocks.nationalPartyElections.find).toHaveBeenCalledWith({
      countryId: "US",
      status: "voting",
    });
  });
});
