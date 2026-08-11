import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Character } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/time/gameTime", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/time/gameTime")>()),
  getGameTime: vi.fn().mockResolvedValue({
    currentTurn: 100,
    effectiveNow: new Date(),
    lastTurnProcessed: new Date(),
    isActive: true,
    pausedAt: null,
  }),
}));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));

describe("GET /api/canvassing/eligibility", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("electionCandidates").find.mockReturnValue({
      toArray: () => Promise.resolve([]),
    });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("returns 401 when unauthenticated", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    } as never);

    const { GET } = await import("./route");
    const res = await GET();

    expect(res.status).toBe(401);
  });

  it("returns home state for an authenticated non-candidate", async () => {
    const character = { _id: new ObjectId(), homeState: "GA" } as Character;
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "u1", character },
    } as never);

    const { GET } = await import("./route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, stateId: "GA", source: "home" });
  });

  it("returns travel state for a presidential candidate in the general phase", async () => {
    const character = { _id: new ObjectId(), homeState: "GA" } as Character;
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const electionId = new ObjectId();
    db.collection("electionCandidates").find.mockReturnValue({
      toArray: () =>
        Promise.resolve([
          {
            _id: new ObjectId(),
            electionId,
            characterId: character._id,
            status: "active",
            travelState: "PA",
          },
        ]),
    });
    db.collection("elections").find.mockReturnValue({
      toArray: () =>
        Promise.resolve([
          {
            _id: electionId,
            electionType: "president",
            status: "active",
            primaryEndTime: past,
          },
        ]),
    });
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "u1", character },
    } as never);

    const { GET } = await import("./route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, stateId: "PA", source: "travel" });
  });
});
