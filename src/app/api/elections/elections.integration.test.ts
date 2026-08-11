/**
 * Integration tests for elections API routes.
 * Tests GET structure, validation, and error responses with mocked DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

// Mock dependencies
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(null),
    set: vi.fn(),
  }),
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(null),
  }),
}));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    jwtVerify: vi.fn().mockRejectedValue(new Error("No token")),
  };
});

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getAuthUser: vi.fn().mockResolvedValue(null),
    getAuthUserWithCharacter: vi.fn().mockResolvedValue(null),
  };
});

vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn(),
}));

const mockCollection = (name: string) => {
  if (name === "elections") {
    return {
      countDocuments: vi.fn().mockResolvedValue(0),
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          skip: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          }),
        }),
      }),
      findOne: vi.fn().mockResolvedValue(null),
    };
  }
  if (name === "electionCandidates")
    return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
  if (name === "characters")
    return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
  if (name === "npps")
    return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
  if (name === "politicalParties")
    return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
  if (name === "nppEndorsements")
    return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
  if (name === "electionVoteTallies")
    return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
  if (name === "primarySnapshots")
    return { aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
  if (name === "gameState")
    return {
      findOne: vi.fn().mockResolvedValue({
        _id: "current",
        isActive: true,
        currentTurn: 1,
        lastTurnProcessed: new Date(),
      }),
    };
  return {};
};

describe("GET /api/elections", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation(mockCollection),
    } as never);
  });

  it("returns elections array and total structure", async () => {
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/elections?country=US");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("elections");
    expect(json).toHaveProperty("total");
    expect(Array.isArray(json.elections)).toBe(true);
    expect(typeof json.total).toBe("number");
  });

  it("returns 400 when neither id nor country is provided", async () => {
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/elections");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("country");
  });
});

describe("GET /api/elections?id=...", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation(mockCollection),
    } as never);
  });

  it("returns 404 for invalid election ID (non-ObjectId, non-seatId)", async () => {
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/elections?id=invalid-id");
    const res = await GET(req);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Election not found");
  });

  it("returns 404 when election not found by ObjectId", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const validId = new ObjectId();
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "elections") return { findOne: vi.fn().mockResolvedValue(null) };
        if (name === "gameState")
          return {
            findOne: vi.fn().mockResolvedValue({
              _id: "current",
              isActive: true,
              currentTurn: 1,
              lastTurnProcessed: new Date(),
            }),
          };
        return {};
      }),
    } as never);

    const { GET } = await import("./route");
    const req = new Request(`http://localhost/api/elections?id=${validId.toString()}`);
    const res = await GET(req);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Election not found");
  });
});

describe("POST /api/elections/[id]/enter", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { cookies } = await import("next/headers");
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn().mockReturnValue(null),
      set: vi.fn(),
    } as never);
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    const { NextResponse } = await import("next/server");
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: false,
      response: NextResponse.json(
        { error: "Authentication with character required", code: "UNAUTHORIZED" },
        { status: 401 }
      ),
    } as never);

    const { POST } = await import("./[id]/enter/route");
    const req = new Request("http://localhost/api/elections/507f1f77bcf86cd799439011/enter", {
      method: "POST",
    });
    const res = await POST(req, { params: Promise.resolve({ id: "507f1f77bcf86cd799439011" }) });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Authentication with character required");
  });

  it("returns 400 for invalid election ID", async () => {
    const { getDb } = await import("@/lib/mongodb");
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: "507f1f77bcf86cd799439011",
        username: "t",
        email: "t@t.com",
        role: "user",
        isAdmin: false,
        hasCharacter: true,
        character: {
          _id: new ObjectId(),
          name: "C",
          party: "1",
          homeState: "US-TX",
          countryId: "US",
        },
      },
    } as never);
    vi.mocked(getDb).mockResolvedValue({} as never);

    const { POST } = await import("./[id]/enter/route");
    const req = new Request("http://localhost/api/elections/not-valid-id/enter", {
      method: "POST",
    });
    const res = await POST(req, { params: Promise.resolve({ id: "not-valid-id" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid election ID");
  });
});

describe("POST /api/parties/[id]/election/enter", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { NextResponse } = await import("next/server");
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockReset();
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: false,
      response: NextResponse.json(
        { error: "Authentication with character required", code: "UNAUTHORIZED" },
        { status: 401 }
      ),
    } as never);
  });

  it("returns 401 when no character", async () => {
    const { POST } = await import("../country/[code]/parties/[id]/election/enter/route");
    const req = new Request("http://localhost/api/parties/us_democrat/election/enter", {
      method: "POST",
      body: JSON.stringify({ position: "chair" }),
    });
    const res = await POST(req, { params: Promise.resolve({ code: "us", id: "democrat" }) });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain("Authentication with character required");
  });

  it("returns 400 for invalid body - missing position", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: "u1",
        username: "t",
        email: "a@b.c",
        role: "user",
        isAdmin: false,
        hasCharacter: true,
        character: {
          _id: new ObjectId(),
          party: "democrat",
          name: "Test",
          homeState: "CA",
          countryId: "US",
        },
      },
    } as never);

    const { POST } = await import("../country/[code]/parties/[id]/election/enter/route");
    const req = new Request("http://localhost/api/parties/us_democrat/election/enter", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req, { params: Promise.resolve({ code: "us", id: "democrat" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("position");
  });

  it("returns 400 for invalid body - invalid position", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: "u1",
        username: "t",
        email: "a@b.c",
        role: "user",
        isAdmin: false,
        hasCharacter: true,
        character: {
          _id: new ObjectId(),
          party: "democrat",
          name: "Test",
          homeState: "CA",
          countryId: "US",
        },
      },
    } as never);

    const { POST } = await import("../country/[code]/parties/[id]/election/enter/route");
    const req = new Request("http://localhost/api/parties/us_democrat/election/enter", {
      method: "POST",
      body: JSON.stringify({ position: "president" }),
    });
    const res = await POST(req, { params: Promise.resolve({ code: "us", id: "democrat" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("position");
  });
});

describe("POST /api/parties/[id]/election/vote", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { NextResponse } = await import("next/server");
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockReset();
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: false,
      response: NextResponse.json(
        { error: "Authentication with character required", code: "UNAUTHORIZED" },
        { status: 401 }
      ),
    } as never);
  });

  it("returns 401 when no character", async () => {
    const { POST } = await import("../country/[code]/parties/[id]/election/vote/route");
    const req = new Request("http://localhost/api/parties/us_democrat/election/vote", {
      method: "POST",
      body: JSON.stringify({ candidateId: "507f1f77bcf86cd799439011", position: "chair" }),
    });
    const res = await POST(req, { params: Promise.resolve({ code: "us", id: "democrat" }) });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain("Authentication with character required");
  });

  it("returns 400 for invalid body - missing candidateId", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: "u1",
        username: "t",
        email: "a@b.c",
        role: "user",
        isAdmin: false,
        hasCharacter: true,
        character: {
          _id: new ObjectId(),
          party: "democrat",
          name: "Test",
          homeState: "CA",
          countryId: "US",
        },
      },
    } as never);

    const { POST } = await import("../country/[code]/parties/[id]/election/vote/route");
    const req = new Request("http://localhost/api/parties/us_democrat/election/vote", {
      method: "POST",
      body: JSON.stringify({ position: "chair" }),
    });
    const res = await POST(req, { params: Promise.resolve({ code: "us", id: "democrat" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("candidateId");
  });

  it("returns 400 for invalid body - invalid candidateId format", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: "u1",
        username: "t",
        email: "a@b.c",
        role: "user",
        isAdmin: false,
        hasCharacter: true,
        character: {
          _id: new ObjectId(),
          party: "democrat",
          name: "Test",
          homeState: "CA",
          countryId: "US",
        },
      },
    } as never);

    const { POST } = await import("../country/[code]/parties/[id]/election/vote/route");
    const req = new Request("http://localhost/api/parties/us_democrat/election/vote", {
      method: "POST",
      body: JSON.stringify({ candidateId: "not-valid", position: "chair" }),
    });
    const res = await POST(req, { params: Promise.resolve({ code: "us", id: "democrat" }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("candidateId");
  });
});
