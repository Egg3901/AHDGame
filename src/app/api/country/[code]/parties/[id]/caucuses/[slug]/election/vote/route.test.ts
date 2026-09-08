import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/validate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/validate")>();
  return { ...actual, parseJsonBody: vi.fn() };
});
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/db/caucusLookup", () => ({ findCaucusBySlug: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn() }));

describe("caucus chair election vote route — tenure gate", () => {
  let db: MockDb;
  let characterId: ObjectId;
  const caucusId = new ObjectId();
  const candidateId = new ObjectId();

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    characterId = new ObjectId();
    db.collection("caucusMemberships");
    db.collection("users");
    db.collection("caucusChairElections");
    db.collection("caucusChairCandidates");
    db.collection("caucusChairVotes");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { parseJsonBody } = await import("@/lib/api/validate");
    vi.mocked(parseJsonBody).mockResolvedValue({
      success: true,
      data: { candidateId: candidateId.toString() },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 7,
      countryId: "US",
    } as never);

    const { findCaucusBySlug } = await import("@/lib/db/caucusLookup");
    vi.mocked(findCaucusBySlug).mockResolvedValue({ caucus: { _id: caucusId } } as never);

    db.collectionMocks["caucusMemberships"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      caucusId,
      memberId: characterId,
      status: "active",
    });
    db.collectionMocks["users"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      createdAt: new Date("2025-01-01T00:00:00Z"),
    });
    db.collectionMocks["caucusChairElections"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      caucusId,
      status: "voting",
    });
    db.collectionMocks["caucusChairCandidates"]!.findOne.mockResolvedValue(null);
  });

  async function setup(partyJoinedTurn: number, currentTurn: number, foundedPartyId?: string) {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
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
      },
    } as never);
    const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
    vi.mocked(getCurrentTurn).mockResolvedValue(currentTurn);
  }

  function post() {
    return import("./route").then(({ POST }) =>
      POST(new Request("http://localhost/api", { method: "POST" }), {
        params: Promise.resolve({ code: "us", id: "7", slug: "left" }),
      })
    );
  }

  it("blocks voting in a caucus chair election when party tenure < 24 turns", async () => {
    await setup(20, 30); // 10 served, 14 short
    const response = await post();

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.error).toMatch(/member of this party for \d+ more turn/i);
    expect(payload.turnsRemaining).toBe(14);
  });

  it("lets a founder of this party vote immediately", async () => {
    // Without the founder exemption the three founders of a brand-new party
    // cannot vote in their own caucus race, so it resolves with no votes.
    await setup(30, 30, "7");
    const response = await post();

    expect(response.status).not.toBe(403);
  });

  it("still blocks a founder of a different party from voting", async () => {
    await setup(20, 30, "9");
    const response = await post();

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.turnsRemaining).toBe(14);
  });
});
