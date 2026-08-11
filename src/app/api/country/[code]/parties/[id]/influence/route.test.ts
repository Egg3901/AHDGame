import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/parties/queries/nationalInfluence", () => ({
  getNationalPartyInfluenceView: vi.fn(),
}));
vi.mock("@/lib/parties/commands/nationalInfluence", () => ({
  executeNationalPartyInfluenceQueue: vi.fn(),
}));

describe("GET /api/country/[code]/parties/[id]/influence", () => {
  let db: MockDb;
  const actorId = new ObjectId();
  const baseParty = {
    _id: new ObjectId(),
    sequentialId: 9,
    countryId: "US",
    chairId: actorId,
    viceChairId: null,
    treasurerId: new ObjectId(),
    name: "Reform",
    treasury: 2000,
    politicalStrength: 10,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isAdmin: false,
        character: { _id: actorId },
      },
    } as never);
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue(baseParty as never);
  });

  it("delegates GET reads to the shared national influence query", async () => {
    const { getNationalPartyInfluenceView } =
      await import("@/lib/parties/queries/nationalInfluence");
    vi.mocked(getNationalPartyInfluenceView).mockResolvedValue({
      partyId: "9",
      partyName: "Reform",
      politicalStrength: 10,
      treasury: 2000,
      nppActionPoints: 160,
      nppActionPointCap: 160,
      nppActionPointRegen: 16,
      actions: [],
      availableStates: [],
      stateNames: {},
      targetStates: [],
      nppsByState: {},
      context: { activeElections: [], nppCandidacies: [], candidates: [] },
    });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ code: "us", id: "9" }),
    });

    expect(response.status).toBe(200);
    expect(getNationalPartyInfluenceView).toHaveBeenCalledWith(db, baseParty, "US");
  });

  it("rejects treasurers from the influence surface", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isAdmin: false,
        character: { _id: baseParty.treasurerId },
      },
    } as never);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ code: "us", id: "9" }),
    });

    expect(response.status).toBe(403);
  });
});

describe("POST /api/country/[code]/parties/[id]/influence", () => {
  let db: MockDb;
  const actorId = new ObjectId();
  const baseParty = {
    _id: new ObjectId(),
    sequentialId: 9,
    countryId: "US",
    chairId: actorId,
    viceChairId: null,
    treasurerId: new ObjectId(),
    name: "Reform",
    treasury: 2000,
    politicalStrength: 10,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isAdmin: false,
        character: { _id: actorId },
      },
    } as never);
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue(baseParty as never);
  });

  it("wraps single-item command results using the shared command module", async () => {
    const { executeNationalPartyInfluenceQueue } =
      await import("@/lib/parties/commands/nationalInfluence");
    vi.mocked(executeNationalPartyInfluenceQueue).mockResolvedValue({
      results: [
        {
          success: true,
          outcome: "success",
          message: "Influence applied",
          nppId: new ObjectId().toString(),
          influenceType: "boost_loyalty",
        },
      ],
      party: { politicalStrength: 7, treasury: 1500 },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nppId: new ObjectId().toString(),
          influenceType: "boost_loyalty",
          fundAmount: 100,
          context: {},
        }),
      }),
      {
        params: Promise.resolve({ code: "us", id: "9" }),
      }
    );

    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      outcome: "success",
      message: "Influence applied",
      party: { politicalStrength: 7, treasury: 1500 },
    });
    expect(executeNationalPartyInfluenceQueue).toHaveBeenCalled();
  });
});
