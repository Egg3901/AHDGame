import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));
vi.mock("@/lib/uk/leadership/leadershipCommands", () => ({ initiateLeadershipChallenge: vi.fn() }));

const NOW = new Date("2026-09-17T00:00:00Z");

function makeRequest() {
  return new Request("http://localhost/api/country/uk/parties/2/leadership/challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

async function setup() {
  const errors = await import("@/lib/api/errors");
  const { getDb } = await import("@/lib/mongodb");
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
  const { getGameTime } = await import("@/lib/time/gameTime");
  const { initiateLeadershipChallenge } = await import("@/lib/uk/leadership/leadershipCommands");
  return {
    errors,
    getDb,
    requireAuthWithCharacter,
    findPartyBySequentialId,
    getGameTime,
    initiateLeadershipChallenge,
  };
}

describe("POST /api/country/[code]/parties/[id]/leadership/challenge", () => {
  let db: MockDb;
  let characterId: ObjectId;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("politicalParties");
    characterId = new ObjectId();

    const { getDb, requireAuthWithCharacter, findPartyBySequentialId, getGameTime } = await setup();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "mp",
        isAdmin: false,
        isBanned: false,
        character: { _id: characterId, name: "MP One", party: "2", countryId: "UK" },
      },
    } as never);
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 2,
      countryId: "UK",
      name: "Conservative Party",
    } as never);
    vi.mocked(getGameTime).mockResolvedValue({ currentTurn: 100, effectiveNow: NOW } as never);
  });

  it("returns 401 when unauthenticated", async () => {
    const { requireAuthWithCharacter } = await setup();
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "uk", id: "2" }),
    });
    expect(response.status).toBe(401);
  });

  it("rejects an invalid country code", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "zz", id: "2" }),
    });
    expect(response.status).toBe(400);
  });

  it("returns 404 when the party is not found", async () => {
    const { findPartyBySequentialId } = await setup();
    vi.mocked(findPartyBySequentialId).mockResolvedValue(null);

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "uk", id: "9" }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 403 for characters outside this party", async () => {
    const { requireAuthWithCharacter, initiateLeadershipChallenge } = await setup();
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "other",
        isAdmin: false,
        character: { _id: new ObjectId(), name: "Other", party: "3", countryId: "UK" },
      },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "uk", id: "2" }),
    });
    expect(response.status).toBe(403);
    expect(vi.mocked(initiateLeadershipChallenge)).not.toHaveBeenCalled();
  });

  it("returns 403 for same-party characters in another country", async () => {
    const { requireAuthWithCharacter, initiateLeadershipChallenge } = await setup();
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "expat",
        isAdmin: false,
        character: { _id: new ObjectId(), name: "Expat", party: "2", countryId: "US" },
      },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "uk", id: "2" }),
    });
    expect(response.status).toBe(403);
    expect(vi.mocked(initiateLeadershipChallenge)).not.toHaveBeenCalled();
  });

  it("files the challenge and returns the command payload", async () => {
    const { initiateLeadershipChallenge } = await setup();
    const challengeId = new ObjectId().toString();
    vi.mocked(initiateLeadershipChallenge).mockResolvedValue({
      success: true,
      challengeId,
      status: "gathering",
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "uk", id: "2" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, challengeId, status: "gathering" });
    expect(vi.mocked(initiateLeadershipChallenge)).toHaveBeenCalledWith(
      db,
      "UK",
      "2",
      { _id: characterId, name: "MP One", party: "2" },
      100,
      NOW
    );
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("maps a concurrent challenge to 409", async () => {
    const { initiateLeadershipChallenge, errors } = await setup();
    vi.mocked(initiateLeadershipChallenge).mockRejectedValue(
      errors.conflict("A leadership challenge is already in progress for this party")
    );

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "uk", id: "2" }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/already in progress/);
  });

  it("delegates MP-role gating to the command: non-MP backers surface as 403", async () => {
    // The route checks party membership only; the sitting-MP requirement and
    // the leader-cannot-challenge-themselves rule live in the command.
    const { initiateLeadershipChallenge, errors } = await setup();
    vi.mocked(initiateLeadershipChallenge).mockRejectedValue(
      errors.forbidden("Only a sitting MP of this party can back a leadership challenge")
    );

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "uk", id: "2" }),
    });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/sitting MP/);
  });

  it("maps a leaderless party to 400", async () => {
    const { initiateLeadershipChallenge, errors } = await setup();
    vi.mocked(initiateLeadershipChallenge).mockRejectedValue(
      errors.badRequest("This party has no sitting leader to challenge")
    );

    const { POST } = await import("./route");
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ code: "uk", id: "2" }),
    });
    expect(response.status).toBe(400);
  });
});
