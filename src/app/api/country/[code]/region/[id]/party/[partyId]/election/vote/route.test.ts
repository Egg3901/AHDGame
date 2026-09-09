import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/validate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/validate")>();
  return { ...actual, parseJsonBody: vi.fn() };
});
vi.mock("@/lib/api/rateLimit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/rateLimit")>();
  return { ...actual, checkRateLimit: vi.fn(() => ({ ok: true, remaining: 10, retryAfter: 0 })) };
});
vi.mock("@/lib/utils/statePartyElectionValidation", () => ({
  validateStatePartyElectionAccess: vi.fn(),
}));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));

describe("state party election vote route — tenure gate", () => {
  let db: MockDb;
  let characterId: ObjectId;
  const candidateId = new ObjectId();

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    characterId = new ObjectId();
    db.collection("statePartyCandidates");
    db.collection("statePartyVotes");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { parseJsonBody } = await import("@/lib/api/validate");
    vi.mocked(parseJsonBody).mockResolvedValue({
      success: true,
      data: { candidateId: candidateId.toString(), position: "chair" },
    } as never);

    db.collectionMocks["statePartyCandidates"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId: candidateId,
      status: "active",
    });

    const { getGameTime } = await import("@/lib/time/gameTime");
    vi.mocked(getGameTime).mockResolvedValue({
      currentTurn: 30,
      effectiveNow: new Date("2026-05-04T12:00:00Z"),
    } as never);
  });

  async function mockAccess(partyJoinedTurn: number, foundedPartyId?: string) {
    const { validateStatePartyElectionAccess } =
      await import("@/lib/utils/statePartyElectionValidation");
    vi.mocked(validateStatePartyElectionAccess).mockResolvedValue({
      success: true,
      character: {
        _id: characterId,
        userId: new ObjectId(),
        name: "Voter",
        party: "7",
        countryId: "US",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        partyJoinedAt: new Date("2026-01-02T00:00:00Z"),
        partyJoinedTurn,
        ...(foundedPartyId ? { foundedPartyId } : {}),
      },
      election: {
        _id: new ObjectId(),
        partyId: "7",
        stateId: "CA",
        countryId: "US",
        position: "chair",
        status: "voting",
        endTurn: 50,
        endTime: new Date("2026-05-10T00:00:00Z"),
      },
      stateId: "CA",
      partyId: "7",
    } as never);
  }

  function post() {
    return import("./route").then(({ POST }) =>
      POST(new Request("http://localhost/api", { method: "POST" }), {
        params: Promise.resolve({ code: "us", id: "CA", partyId: "7" }),
      })
    );
  }

  it("blocks voting in state leadership when party tenure < 24 turns", async () => {
    await mockAccess(20); // 30 - 20 = 10 served, 14 short
    const response = await post();

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.error).toMatch(/member of this party for \d+ more turn/i);
    expect(payload.turnsRemaining).toBe(14);
  });

  it("lets a founder of this party vote in state leadership immediately", async () => {
    await mockAccess(30, "7"); // 0 served, but founded party 7
    const response = await post();

    expect(response.status).not.toBe(403);
  });

  it("still blocks a founder of a different party from voting", async () => {
    await mockAccess(20, "9"); // founded 9, voting in 7
    const response = await post();

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.turnsRemaining).toBe(14);
  });
});
