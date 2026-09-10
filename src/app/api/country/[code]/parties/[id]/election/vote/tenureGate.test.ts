import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/validate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/validate")>();
  return { ...actual, parseJsonBody: vi.fn() };
});
vi.mock("@/lib/api/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/rateLimit")>();
  return { ...actual, checkRateLimit: vi.fn(() => ({ ok: true, remaining: 10, retryAfter: 0 })) };
});
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));

describe("national party leadership vote route — tenure gate", () => {
  let db: MockDb;
  let characterId: ObjectId;
  const candidateId = new ObjectId();

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    characterId = new ObjectId();
    db.collection("nationalPartyElections");
    db.collection("nationalPartyCandidates");
    db.collection("nationalPartyVotes");
    db.collection("users");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { parseJsonBody } = await import("@/lib/api/validate");
    vi.mocked(parseJsonBody).mockResolvedValue({
      success: true,
      data: { candidateId: candidateId.toString(), position: "chair" },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 7,
      countryId: "US",
      leadershipElectionMethod: "membership",
    } as never);

    db.collectionMocks["nationalPartyElections"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      partyId: "7",
      countryId: "US",
      position: "chair",
      status: "voting",
      endTurn: 50,
      endTime: new Date("2026-05-10T00:00:00Z"),
    });
    db.collectionMocks["users"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      createdAt: new Date("2025-01-01T00:00:00Z"),
    });

    const { getGameTime } = await import("@/lib/time/gameTime");
    vi.mocked(getGameTime).mockResolvedValue({
      currentTurn: 30,
      effectiveNow: new Date("2026-05-04T12:00:00Z"),
    } as never);
  });

  async function authWithTenure(partyJoinedTurn: number, foundedPartyId?: string) {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isBanned: false,
        character: {
          _id: characterId,
          name: "Voter",
          party: "7",
          countryId: "US",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          partyJoinedAt: new Date("2026-01-02T00:00:00Z"),
          partyJoinedTurn,
          ...(foundedPartyId ? { foundedPartyId } : {}),
        },
      },
    } as never);
  }

  function post() {
    return import("./route").then(({ POST }) =>
      POST(new Request("http://localhost/api", { method: "POST" }), {
        params: Promise.resolve({ code: "us", id: "7" }),
      })
    );
  }

  it("blocks voting in national leadership when party tenure < 24 turns", async () => {
    await authWithTenure(20); // 30 - 20 = 10 served, 14 short
    const response = await post();

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.error).toMatch(/member of this party for \d+ more turn/i);
    expect(payload.turnsRemaining).toBe(14);
  });

  it("lets a founder of this party vote in national leadership immediately", async () => {
    // A brand-new party's only members are its three founders; without the
    // exemption none of them can vote and the race resolves with no votes.
    await authWithTenure(30, "7");
    const response = await post();

    expect(response.status).not.toBe(403);
  });

  it("still blocks a founder of a different party from voting", async () => {
    await authWithTenure(20, "9"); // founded 9, voting in 7
    const response = await post();

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.turnsRemaining).toBe(14);
  });
});
