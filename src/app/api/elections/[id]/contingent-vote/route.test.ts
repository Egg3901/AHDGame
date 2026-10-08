import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireHumanSessionWithCharacter: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUserWithCharacter: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));
vi.mock("@/lib/elections/electionParamResolution", () => ({ resolveElectionRouteParam: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/elections/contingentHouseVoteView", () => ({
  buildContingentHouseVoteView: vi.fn(),
}));

import { GET, POST } from "./route";
import { getDb } from "@/lib/mongodb";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { getGameTime } from "@/lib/time/gameTime";
import { resolveElectionRouteParam } from "@/lib/elections/electionParamResolution";
import { buildContingentHouseVoteView } from "@/lib/elections/contingentHouseVoteView";

const electionOid = new ObjectId();
const memberOid = new ObjectId();
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
  return new Request("http://localhost/api/elections/x/contingent-vote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("contingent-vote route", () => {
  let db: MockDb;

  function setup(opts: {
    vote?: unknown;
    turn?: number;
    seat?: unknown;
    electionType?: string;
    countryId?: string;
  }) {
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({
      ok: true,
      election: {
        _id: electionOid,
        electionType: opts.electionType ?? "president",
        countryId: opts.countryId ?? "US",
        state: "US",
      },
    } as never);
    vi.mocked(requireHumanSessionWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        character: { _id: memberOid, name: "Member", countryId: "US" },
      },
    } as never);
    vi.mocked(getGameTime).mockResolvedValue({ currentTurn: opts.turn ?? 20 } as never);
    db.collection("electionVoteTallies").findOne.mockResolvedValue(
      opts.vote === undefined
        ? { contingentHouseVote: openVote() }
        : { contingentHouseVote: opts.vote }
    );
    db.collection("electionVoteTallies").updateOne.mockResolvedValue({ matchedCount: 1 });
    db.collection("electedOfficials").findOne.mockResolvedValue(
      opts.seat === undefined ? { state: "OH" } : opts.seat
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockReturnValue({ ok: true } as never);
  });

  describe("POST", () => {
    it("stores the member's vote atomically under their id", async () => {
      setup({});
      const res = await POST(post({ candidateId: candA }), params);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await res.json()).toMatchObject({ success: true, choiceId: candA });

      const [filter, update] = db.collectionMocks.electionVoteTallies!.updateOne.mock.calls[0];
      expect(filter).toMatchObject({
        "contingentHouseVote.status": "open",
        "contingentHouseVote.closesTurn": { $gt: 20 },
        "contingentHouseVote.eligibleCandidateIds": candA,
      });
      expect(update.$set[`contingentHouseVote.votes.${memberOid.toString()}`]).toBe(candA);
      // Looked up the member's own House seat.
      expect(db.collectionMocks.electedOfficials!.findOne.mock.calls[0][0]).toMatchObject({
        officeType: "house",
        characterId: memberOid,
      });
    });

    it("lets a member change their vote", async () => {
      setup({ vote: openVote({ votes: { [memberOid.toString()]: candA } }) });
      const res = await POST(post({ candidateId: candB }), params);
      expect(res.status).toBe(200);
      const update = db.collectionMocks.electionVoteTallies!.updateOne.mock.calls[0][1];
      expect(update.$set[`contingentHouseVote.votes.${memberOid.toString()}`]).toBe(candB);
    });

    it("rejects unauthenticated callers", async () => {
      setup({});
      vi.mocked(requireHumanSessionWithCharacter).mockResolvedValue({
        ok: false,
        response: new Response("{}", { status: 401 }),
      } as never);
      expect((await POST(post({ candidateId: candA }), params)).status).toBe(401);
    });

    it("rate limits", async () => {
      setup({});
      const { rateLimitResponse } = await import("@/lib/api/rateLimit");
      vi.mocked(checkRateLimit).mockReturnValue({ ok: false, retryAfter: 5 } as never);
      vi.mocked(rateLimitResponse).mockReturnValue(new Response("{}", { status: 429 }) as never);
      expect((await POST(post({ candidateId: candA }), params)).status).toBe(429);
    });

    it("rejects a malformed body", async () => {
      setup({});
      expect((await POST(post({ candidateId: "nope" }), params)).status).toBe(400);
      expect((await POST(post({}), params)).status).toBe(400);
    });

    it("rejects a candidate that is not on the ballot", async () => {
      setup({});
      const res = await POST(post({ candidateId: new ObjectId().toString() }), params);
      expect(res.status).toBe(400);
      expect(db.collectionMocks.electionVoteTallies!.updateOne).not.toHaveBeenCalled();
    });

    it("rejects callers who do not sit in the House", async () => {
      setup({ seat: null });
      const res = await POST(post({ candidateId: candA }), params);
      expect(res.status).toBe(403);
      expect(db.collectionMocks.electionVoteTallies!.updateOne).not.toHaveBeenCalled();
    });

    it("rejects a DC delegate", async () => {
      setup({ seat: { state: "DC" } });
      expect((await POST(post({ candidateId: candA }), params)).status).toBe(403);
    });

    it("rejects votes once the window has closed", async () => {
      setup({ turn: 34 });
      expect((await POST(post({ candidateId: candA }), params)).status).toBe(409);
      setup({ vote: openVote({ status: "closed" }) });
      expect((await POST(post({ candidateId: candA }), params)).status).toBe(409);
      expect(db.collectionMocks.electionVoteTallies!.updateOne).not.toHaveBeenCalled();
    });

    it("reports a close that lands between the check and the write", async () => {
      setup({});
      db.collectionMocks.electionVoteTallies!.updateOne.mockResolvedValue({ matchedCount: 0 });
      expect((await POST(post({ candidateId: candA }), params)).status).toBe(409);
    });

    it("404s when the election has no House vote", async () => {
      setup({ vote: null });
      db.collectionMocks.electionVoteTallies!.findOne.mockResolvedValue({});
      expect((await POST(post({ candidateId: candA }), params)).status).toBe(404);
    });

    it("rejects non-presidential elections and other countries", async () => {
      setup({ electionType: "house" });
      expect((await POST(post({ candidateId: candA }), params)).status).toBe(400);
      setup({ countryId: "UK" });
      expect((await POST(post({ candidateId: candA }), params)).status).toBe(400);
    });
  });

  describe("GET", () => {
    it("returns the view with the viewer's choice, never cached", async () => {
      setup({});
      vi.mocked(getAuthUserWithCharacter).mockResolvedValue({
        character: { _id: memberOid },
      } as never);
      vi.mocked(buildContingentHouseVoteView).mockResolvedValue({ status: "open" } as never);
      const res = await GET(new Request("http://localhost/x"), params);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await res.json()).toEqual({ vote: { status: "open" } });
      expect(vi.mocked(buildContingentHouseVoteView).mock.calls[0][4]).toBe(memberOid);
    });

    it("works for anonymous viewers", async () => {
      setup({});
      vi.mocked(getAuthUserWithCharacter).mockResolvedValue(null as never);
      vi.mocked(buildContingentHouseVoteView).mockResolvedValue({ status: "open" } as never);
      const res = await GET(new Request("http://localhost/x"), params);
      expect(res.status).toBe(200);
      expect(vi.mocked(buildContingentHouseVoteView).mock.calls[0][4]).toBeNull();
    });

    it("returns null when the election has no House vote", async () => {
      setup({ vote: undefined });
      db.collectionMocks.electionVoteTallies!.findOne.mockResolvedValue({});
      const res = await GET(new Request("http://localhost/x"), params);
      expect(await res.json()).toEqual({ vote: null });
      expect(buildContingentHouseVoteView).not.toHaveBeenCalled();
    });
  });
});
