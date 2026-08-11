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

describe("caucus chair election enter route — tenure gate", () => {
  let db: MockDb;
  let characterId: ObjectId;
  const caucusId = new ObjectId();

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    characterId = new ObjectId();
    db.collection("caucusMemberships");
    db.collection("users");
    db.collection("caucusChairElections");
    db.collection("caucusChairCandidates");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { parseJsonBody } = await import("@/lib/api/validate");
    vi.mocked(parseJsonBody).mockResolvedValue({
      success: true,
      data: { withdraw: false },
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

  async function setup(partyJoinedTurn: number, currentTurn: number) {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        character: {
          _id: characterId,
          userId: new ObjectId(),
          name: "Candidate",
          party: "7",
          countryId: "US",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          partyJoinedAt: new Date("2026-01-02T00:00:00Z"),
          partyJoinedTurn,
        },
      },
    } as never);
    const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
    vi.mocked(getCurrentTurn).mockResolvedValue(currentTurn);
  }

  it("blocks running for caucus chair when party tenure < 24 turns", async () => {
    await setup(20, 30); // 10 served, 14 short
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api"), {
      params: Promise.resolve({ code: "us", id: "7", slug: "left" }),
    });

    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.error).toMatch(/member of this party for \d+ more turn/i);
    expect(payload.turnsRemaining).toBe(14);
  });

  it("lets a sufficiently-tenured member past the caucus tenure gate (>= 24 turns)", async () => {
    await setup(6, 30); // 24 served -> eligible
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api"), {
      params: Promise.resolve({ code: "us", id: "7", slug: "left" }),
    });

    expect(response.status).not.toBe(403);
  });
});
