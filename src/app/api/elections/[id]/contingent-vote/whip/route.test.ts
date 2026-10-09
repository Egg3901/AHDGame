import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireHumanSessionWithCharacter: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));
vi.mock("@/lib/elections/electionParamResolution", () => ({ resolveElectionRouteParam: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));

import { POST } from "./route";
import { getDb } from "@/lib/mongodb";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { getGameTime } from "@/lib/time/gameTime";
import { resolveElectionRouteParam } from "@/lib/elections/electionParamResolution";

const electionOid = new ObjectId();
const chairOid = new ObjectId();
const candA = new ObjectId().toString();
const candB = new ObjectId().toString();
const params = { params: Promise.resolve({ id: electionOid.toString() }) };

function openVote(overrides: Record<string, unknown> = {}) {
  return {
    status: "open",
    openedTurn: 10,
    closesTurn: 34,
    actingPresidentId: new ObjectId().toString(),
    actingPresidentName: "Acting Person",
    eligibleCandidateIds: [candA, candB],
    votes: {},
    ...overrides,
  };
}

function post(body: unknown): Request {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("contingent-vote whip route", () => {
  let db: MockDb;

  function setup(opts: {
    vote?: unknown;
    turn?: number;
    parties?: unknown[];
    coalitions?: unknown[];
    electionType?: string;
  }) {
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({
      ok: true,
      election: {
        _id: electionOid,
        electionType: opts.electionType ?? "president",
        countryId: "US",
        state: "US",
      },
    } as never);
    vi.mocked(requireHumanSessionWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        character: { _id: chairOid, name: "Chair Person", countryId: "US" },
      },
    } as never);
    vi.mocked(getGameTime).mockResolvedValue({ currentTurn: opts.turn ?? 20 } as never);
    db.collection("electionVoteTallies").findOne.mockResolvedValue({
      contingentHouseVote: opts.vote === undefined ? openVote() : opts.vote,
    });
    db.collection("electionVoteTallies").updateOne.mockResolvedValue({ matchedCount: 1 });
    db.collection("politicalParties").find.mockReturnValue({
      project: () => ({
        toArray: async () => opts.parties ?? [{ sequentialId: 3, name: "Party Three" }],
      }),
    });
    db.collection("coalitions").find.mockReturnValue({
      project: () => ({ toArray: async () => opts.coalitions ?? [] }),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockReturnValue({ ok: true } as never);
  });

  it("lets the party chair whip their party, written atomically under the party key", async () => {
    setup({});
    const res = await POST(post({ scope: "party", candidateId: candA }), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toMatchObject({ success: true, key: "party:3", candidateId: candA });
    const [filter, update] = db.collectionMocks.electionVoteTallies!.updateOne.mock.calls[0];
    expect(filter).toMatchObject({
      "contingentHouseVote.status": "open",
      "contingentHouseVote.closesTurn": { $gt: 20 },
    });
    expect(update.$set["contingentHouseVote.whips.party:3"]).toMatchObject({
      candidateId: candA,
      setBy: chairOid.toString(),
      setByName: "Chair Person",
      turn: 20,
    });
    // Looked up parties chaired by the caller.
    expect(db.collectionMocks.politicalParties!.find.mock.calls[0][0]).toMatchObject({
      chairId: chairOid,
    });
  });

  it("lets the coalition chair whip the coalition and accepts a free vote", async () => {
    setup({ coalitions: [{ sequentialId: 7, name: "Coalition Seven" }] });
    const res = await POST(post({ scope: "coalition", candidateId: "free" }), params);
    expect(res.status).toBe(200);
    const update = db.collectionMocks.electionVoteTallies!.updateOne.mock.calls[0][1];
    expect(update.$set["contingentHouseVote.whips.coalition:7"]).toMatchObject({
      candidateId: "free",
    });
  });

  it("clears a whip", async () => {
    setup({});
    const res = await POST(post({ scope: "party", candidateId: "clear" }), params);
    expect(res.status).toBe(200);
    const update = db.collectionMocks.electionVoteTallies!.updateOne.mock.calls[0][1];
    expect(update.$unset).toEqual({ "contingentHouseVote.whips.party:3": "" });
  });

  it("needs the sequential id when the caller chairs several parties", async () => {
    setup({
      parties: [
        { sequentialId: 3, name: "Party Three" },
        { sequentialId: 4, name: "Party Four" },
      ],
    });
    expect((await POST(post({ scope: "party", candidateId: candA }), params)).status).toBe(403);
    const res = await POST(post({ scope: "party", sequentialId: 4, candidateId: candA }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ key: "party:4" });
  });

  it("rejects callers who do not chair the party or coalition", async () => {
    setup({ parties: [], coalitions: [] });
    expect((await POST(post({ scope: "party", candidateId: candA }), params)).status).toBe(403);
    expect((await POST(post({ scope: "coalition", candidateId: candA }), params)).status).toBe(403);
    expect(db.collectionMocks.electionVoteTallies!.updateOne).not.toHaveBeenCalled();
  });

  it("rejects a chair of a different party than the one named", async () => {
    setup({});
    const res = await POST(post({ scope: "party", sequentialId: 9, candidateId: candA }), params);
    expect(res.status).toBe(403);
  });

  it("rejects unauthenticated callers, rate limited callers and bad bodies", async () => {
    setup({});
    vi.mocked(requireHumanSessionWithCharacter).mockResolvedValue({
      ok: false,
      response: new Response("{}", { status: 401 }),
    } as never);
    expect((await POST(post({ scope: "party", candidateId: candA }), params)).status).toBe(401);

    setup({});
    const { rateLimitResponse } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({ ok: false, retryAfter: 5 } as never);
    vi.mocked(rateLimitResponse).mockReturnValue(new Response("{}", { status: 429 }) as never);
    expect((await POST(post({ scope: "party", candidateId: candA }), params)).status).toBe(429);

    vi.mocked(checkRateLimit).mockReturnValue({ ok: true } as never);
    setup({});
    expect((await POST(post({ scope: "nation", candidateId: candA }), params)).status).toBe(400);
    expect((await POST(post({ scope: "party", candidateId: "nope" }), params)).status).toBe(400);
  });

  it("rejects a candidate that is not on the ballot", async () => {
    setup({});
    const res = await POST(
      post({ scope: "party", candidateId: new ObjectId().toString() }),
      params
    );
    expect(res.status).toBe(400);
    expect(db.collectionMocks.electionVoteTallies!.updateOne).not.toHaveBeenCalled();
  });

  it("rejects once the vote has closed or never existed", async () => {
    setup({ turn: 34 });
    expect((await POST(post({ scope: "party", candidateId: candA }), params)).status).toBe(409);
    setup({ vote: openVote({ status: "closed" }) });
    expect((await POST(post({ scope: "party", candidateId: candA }), params)).status).toBe(409);
    setup({});
    db.collection("electionVoteTallies").findOne.mockResolvedValue({});
    expect((await POST(post({ scope: "party", candidateId: candA }), params)).status).toBe(404);
    setup({});
    db.collectionMocks.electionVoteTallies!.updateOne.mockResolvedValue({ matchedCount: 0 });
    expect((await POST(post({ scope: "party", candidateId: candA }), params)).status).toBe(409);
  });

  it("only applies to presidential elections", async () => {
    setup({ electionType: "house" });
    expect((await POST(post({ scope: "party", candidateId: candA }), params)).status).toBe(400);
  });
});
