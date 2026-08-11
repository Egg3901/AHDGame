import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn(),
}));
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));
// Turn-first window checks call getCurrentTurn; fixtures use realtimeMs windows
// (no endsOnTurn) so the route falls back to the wall-clock assertions here.
vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: vi.fn(async () => 0),
}));

import { POST } from "../route";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";

const HOUSE_MEMBER = {
  _id: new ObjectId(),
  countryId: "US",
  currentOffice: { type: "house" },
};
const SENATE_MEMBER = {
  _id: new ObjectId(),
  countryId: "US",
  currentOffice: { type: "senate" },
};

function mockReq(body: unknown): Request {
  return new Request("http://test/api/country/US/sovereign-resolution/vote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockDbWithDecision(decisions: Array<Record<string, unknown>>) {
  const sets: Array<Record<string, unknown>> = [];
  return {
    sets,
    db: {
      collection: vi.fn(() => ({
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue(decisions),
            }),
          }),
        }),
        updateOne: vi.fn(async (_f, u: Record<string, unknown>) => {
          sets.push(u as Record<string, unknown>);
          return { acknowledged: true, modifiedCount: 1 };
        }),
      })),
    } as never,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/country/[code]/sovereign-resolution/vote", () => {
  it("401 unauthenticated", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: false,
      response: new Response("nope", { status: 401 }),
    } as never);
    const res = await POST(mockReq({ vote: "for" }), {
      params: Promise.resolve({ code: "US" }),
    });
    expect(res.status).toBe(401);
  });

  it("400 invalid vote value", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: HOUSE_MEMBER },
    } as never);
    const res = await POST(mockReq({ vote: "yes" }), {
      params: Promise.resolve({ code: "US" }),
    });
    expect(res.status).toBe(400);
  });

  it("409 when no executiveProposed decision", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: HOUSE_MEMBER },
    } as never);
    const { db } = mockDbWithDecision([]);
    vi.mocked(getDb).mockResolvedValue(db);
    const res = await POST(mockReq({ vote: "for" }), {
      params: Promise.resolve({ code: "US" }),
    });
    expect(res.status).toBe(409);
  });

  it("403 when character not in active chamber", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: SENATE_MEMBER },
    } as never);
    const decisionId = new ObjectId();
    const { db } = mockDbWithDecision([
      {
        _id: decisionId,
        state: "executiveProposed",
        countryCode: "US",
        currentChamberIndex: 0,
        legislativePhases: [
          {
            chamberKey: "house",
            startedAtRealtimeMs: Date.now(),
            endsAtRealtimeMs: Date.now() + 10_000,
            votesFor: 0,
            votesAgainst: 0,
            votes: {},
            outcome: "pending",
          },
        ],
      },
    ]);
    vi.mocked(getDb).mockResolvedValue(db);
    const res = await POST(mockReq({ vote: "for" }), {
      params: Promise.resolve({ code: "US" }),
    });
    expect(res.status).toBe(403);
  });

  it("409 when phase outcome already tallied", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: HOUSE_MEMBER },
    } as never);
    const decisionId = new ObjectId();
    const { db } = mockDbWithDecision([
      {
        _id: decisionId,
        state: "executiveProposed",
        countryCode: "US",
        currentChamberIndex: 0,
        legislativePhases: [
          {
            chamberKey: "house",
            startedAtRealtimeMs: Date.now(),
            endsAtRealtimeMs: Date.now() + 10_000,
            votesFor: 0,
            votesAgainst: 0,
            votes: {},
            outcome: "passed",
          },
        ],
      },
    ]);
    vi.mocked(getDb).mockResolvedValue(db);
    const res = await POST(mockReq({ vote: "for" }), {
      params: Promise.resolve({ code: "US" }),
    });
    expect(res.status).toBe(409);
  });

  it("409 when phase voting window already closed", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: HOUSE_MEMBER },
    } as never);
    const decisionId = new ObjectId();
    const { db } = mockDbWithDecision([
      {
        _id: decisionId,
        state: "executiveProposed",
        countryCode: "US",
        currentChamberIndex: 0,
        legislativePhases: [
          {
            chamberKey: "house",
            startedAtRealtimeMs: Date.now() - 100_000,
            endsAtRealtimeMs: Date.now() - 1_000,
            votesFor: 0,
            votesAgainst: 0,
            votes: {},
            outcome: "pending",
          },
        ],
      },
    ]);
    vi.mocked(getDb).mockResolvedValue(db);
    const res = await POST(mockReq({ vote: "for" }), {
      params: Promise.resolve({ code: "US" }),
    });
    expect(res.status).toBe(409);
  });

  it("409 when character has already voted", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: HOUSE_MEMBER },
    } as never);
    const decisionId = new ObjectId();
    const { db } = mockDbWithDecision([
      {
        _id: decisionId,
        state: "executiveProposed",
        countryCode: "US",
        currentChamberIndex: 0,
        legislativePhases: [
          {
            chamberKey: "house",
            startedAtRealtimeMs: Date.now(),
            endsAtRealtimeMs: Date.now() + 10_000,
            votesFor: 1,
            votesAgainst: 0,
            votes: { [HOUSE_MEMBER._id.toString()]: "for" },
            outcome: "pending",
          },
        ],
      },
    ]);
    vi.mocked(getDb).mockResolvedValue(db);
    const res = await POST(mockReq({ vote: "for" }), {
      params: Promise.resolve({ code: "US" }),
    });
    expect(res.status).toBe(409);
  });

  it("200 records vote and increments tally", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: HOUSE_MEMBER },
    } as never);
    const decisionId = new ObjectId();
    const { db, sets } = mockDbWithDecision([
      {
        _id: decisionId,
        state: "executiveProposed",
        countryCode: "US",
        currentChamberIndex: 0,
        legislativePhases: [
          {
            chamberKey: "house",
            startedAtRealtimeMs: Date.now(),
            endsAtRealtimeMs: Date.now() + 10_000,
            votesFor: 0,
            votesAgainst: 0,
            votes: {},
            outcome: "pending",
          },
        ],
      },
    ]);
    vi.mocked(getDb).mockResolvedValue(db);
    const res = await POST(mockReq({ vote: "for" }), {
      params: Promise.resolve({ code: "US" }),
    });
    expect(res.status).toBe(200);
    expect(sets).toHaveLength(1);
    const set = sets[0] as { $set: Record<string, unknown>; $inc: Record<string, unknown> };
    expect(set.$set[`legislativePhases.0.votes.${HOUSE_MEMBER._id.toString()}`]).toBe("for");
    expect(set.$inc["legislativePhases.0.votesFor"]).toBe(1);
  });

  it("409 when concurrent updateOne races (modifiedCount=0)", async () => {
    // Regression: simulates the race where two parallel requests both pass the
    // in-memory `phase.votes[charKey]` check. The second writer's atomic
    // filter (`{ ${voteFieldKey}: { $exists: false } }`) excludes it, so
    // modifiedCount=0 and the route returns 409 instead of double-incrementing.
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: HOUSE_MEMBER },
    } as never);
    const decisionId = new ObjectId();
    const decisions = [
      {
        _id: decisionId,
        state: "executiveProposed",
        countryCode: "US",
        currentChamberIndex: 0,
        legislativePhases: [
          {
            chamberKey: "house",
            startedAtRealtimeMs: Date.now(),
            endsAtRealtimeMs: Date.now() + 10_000,
            votesFor: 0,
            votesAgainst: 0,
            votes: {},
            outcome: "pending",
          },
        ],
      },
    ];
    const db = {
      collection: vi.fn(() => ({
        find: vi.fn().mockReturnValue({
          sort: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              toArray: vi.fn().mockResolvedValue(decisions),
            }),
          }),
        }),
        updateOne: vi.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 0 }),
      })),
    } as never;
    vi.mocked(getDb).mockResolvedValue(db);
    const res = await POST(mockReq({ vote: "for" }), {
      params: Promise.resolve({ code: "US" }),
    });
    expect(res.status).toBe(409);
  });
});
