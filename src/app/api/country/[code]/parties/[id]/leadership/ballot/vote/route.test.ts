import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));
vi.mock("@/lib/uk/leadership/leadershipCommands", () => ({ castLeadershipBallotVote: vi.fn() }));

const NOW = new Date("2026-09-17T00:00:00Z");

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/country/uk/parties/2/leadership/ballot/vote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function setup() {
  const errors = await import("@/lib/api/errors");
  const { getDb } = await import("@/lib/mongodb");
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
  const { getGameTime } = await import("@/lib/time/gameTime");
  const { castLeadershipBallotVote } = await import("@/lib/uk/leadership/leadershipCommands");
  return {
    errors,
    getDb,
    requireAuthWithCharacter,
    findPartyBySequentialId,
    getGameTime,
    castLeadershipBallotVote,
  };
}

describe("POST /api/country/[code]/parties/[id]/leadership/ballot/vote", () => {
  let db: MockDb;
  let characterId: ObjectId;
  let challengeId: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("politicalParties");
    characterId = new ObjectId();
    challengeId = new ObjectId().toString();

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
    const response = await POST(makeRequest({ challengeId, vote: "aye" }), {
      params: Promise.resolve({ code: "uk", id: "2" }),
    });
    expect(response.status).toBe(401);
  });

  it("rejects an invalid country code", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ challengeId, vote: "aye" }), {
      params: Promise.resolve({ code: "zz", id: "2" }),
    });
    expect(response.status).toBe(400);
  });

  it("returns 404 when the party is not found", async () => {
    const { findPartyBySequentialId } = await setup();
    vi.mocked(findPartyBySequentialId).mockResolvedValue(null);

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ challengeId, vote: "aye" }), {
      params: Promise.resolve({ code: "uk", id: "9" }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 403 for characters outside this party", async () => {
    const { requireAuthWithCharacter, castLeadershipBallotVote } = await setup();
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
    const response = await POST(makeRequest({ challengeId, vote: "aye" }), {
      params: Promise.resolve({ code: "uk", id: "2" }),
    });
    expect(response.status).toBe(403);
    expect(vi.mocked(castLeadershipBallotVote)).not.toHaveBeenCalled();
  });

  it("rejects malformed challenge IDs", async () => {
    const { POST } = await import("./route");
    for (const badId of ["not-an-id", "123", "zzzzzzzzzzzzzzzzzzzzzzzz"]) {
      const response = await POST(makeRequest({ challengeId: badId, vote: "aye" }), {
        params: Promise.resolve({ code: "uk", id: "2" }),
      });
      expect(response.status).toBe(400);
    }
  });

  it("rejects votes outside the aye/nay enum", async () => {
    const { POST } = await import("./route");
    for (const body of [
      { challengeId },
      { challengeId, vote: "abstain" },
      { challengeId, vote: 1 },
    ]) {
      const response = await POST(makeRequest(body), {
        params: Promise.resolve({ code: "uk", id: "2" }),
      });
      expect(response.status).toBe(400);
    }
  });

  it("casts the vote and returns the running tally", async () => {
    const { castLeadershipBallotVote } = await setup();
    vi.mocked(castLeadershipBallotVote).mockResolvedValue({
      success: true,
      votesFor: 3,
      votesAgainst: 1,
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ challengeId, vote: "aye" }), {
      params: Promise.resolve({ code: "uk", id: "2" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, votesFor: 3, votesAgainst: 1 });
    expect(vi.mocked(castLeadershipBallotVote)).toHaveBeenCalledWith(
      db,
      "UK",
      challengeId,
      { _id: characterId, name: "MP One", party: "2" },
      "aye",
      100,
      NOW
    );
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("delegates electorate gating to the command: outsiders of the electorate surface as 403", async () => {
    // The route checks party membership only; the MPs-vs-members electorate
    // rule lives in the command, so a member outside the ballot electorate
    // reaches the command and the command's forbidden maps to 403 here.
    const { castLeadershipBallotVote, errors } = await setup();
    vi.mocked(castLeadershipBallotVote).mockRejectedValue(
      errors.forbidden("Only this party's MPs vote in this ballot")
    );

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ challengeId, vote: "aye" }), {
      params: Promise.resolve({ code: "uk", id: "2" }),
    });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/MPs vote/);
  });

  it("maps an unknown challenge to 404", async () => {
    const { castLeadershipBallotVote, errors } = await setup();
    vi.mocked(castLeadershipBallotVote).mockRejectedValue(
      errors.notFound("Leadership challenge not found")
    );

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ challengeId, vote: "aye" }), {
      params: Promise.resolve({ code: "uk", id: "2" }),
    });
    expect(response.status).toBe(404);
  });

  it("maps a closed ballot to 400", async () => {
    const { castLeadershipBallotVote, errors } = await setup();
    vi.mocked(castLeadershipBallotVote).mockRejectedValue(
      errors.badRequest("The ballot window has closed")
    );

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ challengeId, vote: "aye" }), {
      params: Promise.resolve({ code: "uk", id: "2" }),
    });
    expect(response.status).toBe(400);
  });
});
