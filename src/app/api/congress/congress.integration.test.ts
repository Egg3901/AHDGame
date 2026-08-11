/**
 * Integration tests for Congress API routes.
 * Tests validation, error responses, and structure with mocked DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({
    effectiveNow: new Date("2026-01-15T12:00:00.000Z"),
    currentTurn: 100,
    lastTurnProcessed: new Date("2026-01-15T11:00:00.000Z"),
    pausedAt: null,
    isActive: true,
  }),
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getAuthUser: vi.fn().mockResolvedValue(null),
  };
});

vi.mock("@/lib/db/partyMap", () => ({
  getPartyMap: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("@/lib/congress/houseComposition", () => ({
  getHouseComposition: vi.fn(),
}));

vi.mock("@/lib/congress/senateComposition", () => ({
  getSenateComposition: vi.fn(),
}));

vi.mock("@/lib/congress/leadershipElections", () => ({
  vacateLeadershipBulkIfLostSeat: vi.fn().mockResolvedValue(undefined),
  resolveLeadershipElection: vi.fn().mockResolvedValue(false),
  isLeadershipElectionClosed: (
    el: { endsOnTurn?: number | null; endsAt?: Date | null },
    currentTurn: number,
    effectiveNow: Date
  ) =>
    typeof el?.endsOnTurn === "number"
      ? currentTurn >= el.endsOnTurn
      : !!el?.endsAt && effectiveNow.getTime() >= new Date(el.endsAt).getTime(),
}));

const mockEmptyCollection = () => ({
  find: vi.fn().mockReturnValue({
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnValue({
      skip: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      }),
    }),
    toArray: vi.fn().mockResolvedValue([]),
  }),
  findOne: vi.fn().mockResolvedValue(null),
  countDocuments: vi.fn().mockResolvedValue(0),
  aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
});

describe("GET /api/congress/bills", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation(() => mockEmptyCollection()),
    } as never);
  });

  it("returns bills array, total, and canPropose structure", async () => {
    const { GET } = await import("./bills/route");
    const req = new Request("http://localhost/api/congress/bills");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("bills");
    expect(json).toHaveProperty("total");
    expect(json).toHaveProperty("canPropose");
    expect(Array.isArray(json.bills)).toBe(true);
    // No per-test timeout override here: the 15s global exists precisely for
    // this dynamic route import under parallel load, and a local 10s override
    // put this test *below* it — the only one in the file that could time out.
  });

  it("filters chamber tabs by currentChamber so passed bills move to the next chamber list", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const billsFindResult = {
      toArray: vi.fn().mockResolvedValue([]),
      project: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnValue({
        skip: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        }),
      }),
    };
    const billsFind = vi.fn().mockReturnValue(billsFindResult);

    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "bills") {
          return {
            find: billsFind,
            countDocuments: vi.fn().mockResolvedValue(0),
            findOne: vi.fn().mockResolvedValue(null),
          };
        }
        return mockEmptyCollection();
      }),
    } as never);

    const { GET } = await import("./bills/route");
    const req = new Request("http://localhost/api/congress/bills?chamber=senate");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(billsFind).toHaveBeenCalledWith(expect.objectContaining({ currentChamber: "senate" }));
    expect(billsFind).not.toHaveBeenCalledWith(
      expect.objectContaining({ originChamber: expect.anything() })
    );
  });
});

describe("POST /api/congress/bills", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    const { POST } = await import("./bills/route");
    const req = new Request("http://localhost/api/congress/bills", {
      method: "POST",
      body: JSON.stringify({
        title: "Test Bill",
        summary: "A test",
        chamber: "house",
        category: "economy",
        provisions: [{ legislationTypeId: "lt1", effectDirection: 0 }],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Authentication required");
  });

  it("returns 400 for invalid body - missing title", async () => {
    const auth = await import("@/lib/auth");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(auth.getAuthUser).mockResolvedValue({
      userId: new ObjectId().toString(),
      isAdmin: false,
    } as never);
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "characters") {
          return {
            findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), nationalInfluence: 100 }),
          };
        }
        if (name === "electedOfficials") return { findOne: vi.fn().mockResolvedValue({}) };
        if (name === "legislationTypes")
          return {
            findOne: vi
              .fn()
              .mockResolvedValue({ _id: "lt1", policyDomain: "economy", name: "Test" }),
          };
        if (name === "bills")
          return {
            // findOne is called before Zod validation (active-bill check), so must be present
            findOne: vi.fn().mockResolvedValue(null),
            insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
          };
        return mockEmptyCollection();
      }),
    } as never);

    const { POST } = await import("./bills/route");
    const req = new Request("http://localhost/api/congress/bills", {
      method: "POST",
      body: JSON.stringify({
        summary: "A test",
        chamber: "house",
        category: "economy",
        provisions: [{ legislationTypeId: "lt1", effectDirection: 0 }],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("title");
  });

  it("returns 400 for invalid body - missing provisions", async () => {
    const auth = await import("@/lib/auth");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(auth.getAuthUser).mockResolvedValue({
      userId: new ObjectId().toString(),
      isAdmin: false,
    } as never);
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "characters")
          return {
            findOne: vi.fn().mockResolvedValue({ _id: new ObjectId(), nationalInfluence: 100 }),
          };
        if (name === "electedOfficials") return { findOne: vi.fn().mockResolvedValue({}) };
        return mockEmptyCollection();
      }),
    } as never);

    const { POST } = await import("./bills/route");
    const req = new Request("http://localhost/api/congress/bills", {
      method: "POST",
      body: JSON.stringify({
        title: "Test Bill",
        summary: "A test",
        chamber: "house",
        category: "economy",
        provisions: [],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("provision");
  });
});

describe("GET /api/congress/bills/[id]", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid bill ID", async () => {
    const { GET } = await import("./bills/[id]/route");
    const req = new Request("http://localhost/api/congress/bills/invalid");
    const res = await GET(req, { params: Promise.resolve({ id: "invalid" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid bill ID");
  });

  it("returns 404 when bill not found", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const validId = new ObjectId();
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "bills") return { findOne: vi.fn().mockResolvedValue(null) };
        return mockEmptyCollection();
      }),
    } as never);

    const { GET } = await import("./bills/[id]/route");
    const req = new Request("http://localhost/api/congress/bills/" + validId);
    const res = await GET(req, { params: Promise.resolve({ id: validId.toString() }) });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Bill not found");
  });
});

describe("POST /api/congress/bills/[id]", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it("returns 400 for invalid bill ID", async () => {
    const auth = await import("@/lib/auth");
    vi.mocked(auth.getAuthUser).mockResolvedValue({
      userId: new ObjectId().toString(),
    } as never);

    const { POST } = await import("./bills/[id]/route");
    const req = new Request("http://localhost/api/congress/bills/not-valid-id", {
      method: "POST",
      body: JSON.stringify({ action: "vote", vote: "for" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "not-valid-id" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid bill ID");
  });

  it("returns 401 when not authenticated", async () => {
    const auth = await import("@/lib/auth");
    vi.mocked(auth.getAuthUser).mockResolvedValue(null);

    const validId = new ObjectId();
    const { POST } = await import("./bills/[id]/route");
    const req = new Request("http://localhost/api/congress/bills/" + validId, {
      method: "POST",
      body: JSON.stringify({ action: "vote", vote: "for" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: validId.toString() }) });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Authentication required");
  });

  it("returns 400 for invalid body - invalid action", async () => {
    const auth = await import("@/lib/auth");
    const { getDb } = await import("@/lib/mongodb");
    const validId = new ObjectId();
    vi.mocked(auth.getAuthUser).mockResolvedValue({
      userId: new ObjectId().toString(),
    } as never);
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "characters")
          return { findOne: vi.fn().mockResolvedValue({ _id: new ObjectId() }) };
        if (name === "bills")
          return { findOne: vi.fn().mockResolvedValue({ _id: validId, status: "active" }) };
        return mockEmptyCollection();
      }),
    } as never);

    const { POST } = await import("./bills/[id]/route");
    const req = new Request("http://localhost/api/congress/bills/" + validId, {
      method: "POST",
      body: JSON.stringify({ action: "invalid_action" }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: validId.toString() }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });
});

describe("POST /api/congress/speaker", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it("returns 400 for vote action without nominationId", async () => {
    const auth = await import("@/lib/auth");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(auth.getAuthUser).mockResolvedValue({
      userId: new ObjectId().toString(),
    } as never);
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation(() => mockEmptyCollection()),
    } as never);

    const { POST } = await import("./speaker/route");
    const req = new Request("http://localhost/api/congress/speaker", {
      method: "POST",
      body: JSON.stringify({ action: "vote" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("nominationId");
  });
});

describe("POST /api/congress/house-leadership", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { getHouseComposition } = await import("@/lib/congress/houseComposition");
    vi.mocked(getHouseComposition).mockResolvedValue({
      majorityBloc: {
        partySlugs: new Set(["MAJ"]),
        displayName: "Majority Bloc",
        dominantPartySlug: "MAJ",
        dominantPartySeats: 220,
      },
      majorityParty: "MAJ",
      majoritySeats: 220,
      totalSeats: 435,
      composition: [{ party: "MAJ" }, { party: "OPP" }],
    } as never);
  });

  it("returns 400 for missing role", async () => {
    const auth = await import("@/lib/auth");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(auth.getAuthUser).mockResolvedValue({
      userId: new ObjectId().toString(),
    } as never);
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation(() => mockEmptyCollection()),
    } as never);

    const { POST } = await import("./house-leadership/route");
    const req = new Request("http://localhost/api/congress/house-leadership", {
      method: "POST",
      body: JSON.stringify({ action: "declare" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("role");
  });

  it("blocks House Majority Leader declarations from coalition partners", async () => {
    const auth = await import("@/lib/auth");
    const { getDb } = await import("@/lib/mongodb");
    const { getHouseComposition } = await import("@/lib/congress/houseComposition");
    const db = createMockDb();
    const userId = new ObjectId();
    const characterId = new ObjectId();
    for (const name of ["characters", "electedOfficials", "houseLeadershipElections"]) {
      db.collection(name);
    }

    vi.mocked(auth.getAuthUser).mockResolvedValue({
      userId: userId.toString(),
      isAdmin: false,
    } as never);
    vi.mocked(getDb).mockResolvedValue(db as unknown as MockDb as never);
    vi.mocked(getHouseComposition).mockResolvedValue({
      majorityBloc: {
        partySlugs: new Set(["MAJ", "ALLY"]),
        displayName: "Unity Coalition",
        dominantPartySlug: "MAJ",
        dominantPartySeats: 220,
      },
      majorityParty: "MAJ",
      majoritySeats: 260,
      totalSeats: 435,
      composition: [{ party: "MAJ" }, { party: "ALLY" }, { party: "OPP" }],
    } as never);

    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: characterId,
      userId,
      party: "ALLY",
      name: "Coalition Partner",
      homeState: "TX",
    });
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId,
      officeType: "house",
      state: "TX",
    });
    db.collectionMocks["houseLeadershipElections"]!.findOne.mockResolvedValue({
      _id: "majority_leader",
      status: "voting",
      endsAt: new Date(Date.now() + 60_000),
    });

    const { POST } = await import("./house-leadership/route");
    const req = new Request("http://localhost/api/congress/house-leadership", {
      method: "POST",
      body: JSON.stringify({ action: "declare", role: "majority_leader" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Only the majority party (MAJ) may run.",
    });
  });
});

describe("POST /api/congress/senate-leadership", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { getSenateComposition } = await import("@/lib/congress/senateComposition");
    vi.mocked(getSenateComposition).mockResolvedValue({
      majorityBloc: {
        partySlugs: new Set(["MAJ"]),
        displayName: "Majority Bloc",
        dominantPartySlug: "MAJ",
        dominantPartySeats: 54,
      },
      majorityParty: "MAJ",
      majoritySeats: 54,
      totalSeats: 100,
      composition: [{ party: "MAJ" }, { party: "OPP" }],
    } as never);
  });

  it("returns 400 for missing role", async () => {
    const auth = await import("@/lib/auth");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(auth.getAuthUser).mockResolvedValue({
      userId: new ObjectId().toString(),
    } as never);
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation(() => mockEmptyCollection()),
    } as never);

    const { POST } = await import("./senate-leadership/route");
    const req = new Request("http://localhost/api/congress/senate-leadership", {
      method: "POST",
      body: JSON.stringify({ action: "declare" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("role");
  });

  it("blocks Senate Majority Leader declarations from coalition partners", async () => {
    const auth = await import("@/lib/auth");
    const { getDb } = await import("@/lib/mongodb");
    const { getSenateComposition } = await import("@/lib/congress/senateComposition");
    const db = createMockDb();
    const userId = new ObjectId();
    const characterId = new ObjectId();
    for (const name of ["characters", "electedOfficials", "senateLeadershipElections"]) {
      db.collection(name);
    }

    vi.mocked(auth.getAuthUser).mockResolvedValue({
      userId: userId.toString(),
      isAdmin: false,
    } as never);
    vi.mocked(getDb).mockResolvedValue(db as unknown as MockDb as never);
    vi.mocked(getSenateComposition).mockResolvedValue({
      majorityBloc: {
        partySlugs: new Set(["MAJ", "ALLY"]),
        displayName: "Unity Coalition",
        dominantPartySlug: "MAJ",
        dominantPartySeats: 54,
      },
      majorityParty: "MAJ",
      majoritySeats: 60,
      totalSeats: 100,
      composition: [{ party: "MAJ" }, { party: "ALLY" }, { party: "OPP" }],
    } as never);

    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: characterId,
      userId,
      party: "ALLY",
      name: "Coalition Senator",
      homeState: "AL",
    });
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId,
      officeType: "senate",
      state: "AL",
    });
    db.collectionMocks["senateLeadershipElections"]!.findOne.mockResolvedValue({
      _id: "majority_leader",
      status: "voting",
      endsAt: new Date(Date.now() + 60_000),
    });

    const { POST } = await import("./senate-leadership/route");
    const req = new Request("http://localhost/api/congress/senate-leadership", {
      method: "POST",
      body: JSON.stringify({ action: "declare", role: "majority_leader" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Only the majority party (MAJ) may run.",
    });
  });
});

describe("POST /api/congress/leaders", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { getHouseComposition } = await import("@/lib/congress/houseComposition");
    vi.mocked(getHouseComposition).mockResolvedValue({
      majorityBloc: {
        partySlugs: new Set(["MAJ"]),
        displayName: "Majority Bloc",
        dominantPartySlug: "MAJ",
        dominantPartySeats: 220,
      },
      majorityParty: "MAJ",
      composition: [{ party: "MAJ" }, { party: "OPP" }],
    } as never);
  });

  it("returns 400 for invalid role", async () => {
    const auth = await import("@/lib/auth");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(auth.getAuthUser).mockResolvedValue({
      userId: new ObjectId().toString(),
      isAdmin: true,
    } as never);
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation(() => mockEmptyCollection()),
    } as never);

    const { POST } = await import("./leaders/route");
    const req = new Request("http://localhost/api/congress/leaders", {
      method: "POST",
      body: JSON.stringify({ role: "invalid_role" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("role");
  });

  it("rejects assigning a coalition partner to a majority leader role", async () => {
    const auth = await import("@/lib/auth");
    const { getDb } = await import("@/lib/mongodb");
    const { getHouseComposition } = await import("@/lib/congress/houseComposition");
    const db = createMockDb();
    const characterId = new ObjectId();
    db.collection("characters");
    db.collection("electedOfficials");

    vi.mocked(auth.getAuthUser).mockResolvedValue({
      userId: new ObjectId().toString(),
      isAdmin: true,
    } as never);
    vi.mocked(getDb).mockResolvedValue(db as unknown as MockDb as never);
    vi.mocked(getHouseComposition).mockResolvedValue({
      majorityBloc: {
        partySlugs: new Set(["MAJ", "ALLY"]),
        displayName: "Unity Coalition",
        dominantPartySlug: "MAJ",
        dominantPartySeats: 220,
      },
      majorityParty: "MAJ",
      composition: [{ party: "MAJ" }, { party: "ALLY" }, { party: "OPP" }],
    } as never);

    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: characterId,
      name: "Coalition Partner",
      party: "ALLY",
    });
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      characterId,
      officeType: "house",
    });

    const { POST } = await import("./leaders/route");
    const req = new Request("http://localhost/api/congress/leaders", {
      method: "POST",
      body: JSON.stringify({
        role: "majority_leader_house",
        characterId: characterId.toString(),
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Only the chamber's current majority party may hold this role.",
    });
  });

  it("rejects assigning a non-member even when they belong to the majority party", async () => {
    const auth = await import("@/lib/auth");
    const { getDb } = await import("@/lib/mongodb");
    const { getHouseComposition } = await import("@/lib/congress/houseComposition");
    const db = createMockDb();
    const characterId = new ObjectId();
    db.collection("characters");
    db.collection("electedOfficials");

    vi.mocked(auth.getAuthUser).mockResolvedValue({
      userId: new ObjectId().toString(),
      isAdmin: true,
    } as never);
    vi.mocked(getDb).mockResolvedValue(db as unknown as MockDb as never);
    vi.mocked(getHouseComposition).mockResolvedValue({
      majorityBloc: {
        partySlugs: new Set(["MAJ", "ALLY"]),
        displayName: "Unity Coalition",
        dominantPartySlug: "MAJ",
        dominantPartySeats: 220,
      },
      majorityParty: "MAJ",
      composition: [{ party: "MAJ" }, { party: "ALLY" }, { party: "OPP" }],
    } as never);

    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: characterId,
      name: "Seatless Majority Member",
      party: "MAJ",
    });
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue(null);

    const { POST } = await import("./leaders/route");
    const req = new Request("http://localhost/api/congress/leaders", {
      method: "POST",
      body: JSON.stringify({
        role: "majority_leader_house",
        characterId: characterId.toString(),
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Only current House members may hold this role.",
    });
  });
});
