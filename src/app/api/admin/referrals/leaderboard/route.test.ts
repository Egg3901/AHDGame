import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PATCH } from "./route";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/api/requireAdmin", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/adminLog", () => ({
  createAdminLog: vi.fn(),
}));

vi.mock("@/lib/contests/referralAward", () => {
  class ReferralAwardError extends Error {}
  return { awardReferralContest: vi.fn(), ReferralAwardError };
});

function chainFind(rows: Record<string, unknown>[]) {
  return {
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(rows),
  };
}

describe("GET /api/admin/referrals/leaderboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all-time and contest lists when contest is active", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "admin" },
    } as never);

    const started = new Date("2026-01-01T00:00:00.000Z");
    const userAllTime = {
      _id: { toString: () => "507f1f77bcf86cd799439011" },
      username: "alice",
      displayName: "Alice",
      referralCount: 5,
    };
    const userContest = {
      _id: { toString: () => "507f191e810c19729de860ea" },
      username: "bob",
      displayName: "Bob",
      referralContestCount: 2,
    };

    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "gameConfig") {
          return {
            findOne: vi.fn().mockResolvedValue({
              referralContestStartedAt: started,
            }),
          };
        }
        if (name === "users") {
          const allChain = chainFind([userAllTime]);
          const contestChain = chainFind([userContest]);
          let calls = 0;
          return {
            find: vi.fn().mockImplementation(() => {
              calls += 1;
              return calls === 1 ? allChain : contestChain;
            }),
          };
        }
        return {};
      }),
    } as never);

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.contestMode).toBe(true);
    expect(data.contestStartedAt).toBe(started.toISOString());
    expect(data.allTime).toHaveLength(1);
    expect(data.allTime[0].username).toBe("alice");
    expect(data.allTime[0].count).toBe(5);
    expect(data.contest).toHaveLength(1);
    expect(data.contest[0].username).toBe("bob");
    expect(data.contest[0].count).toBe(2);
  });

  it("skips contest query when contest is not active", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "admin" },
    } as never);

    const findMock = vi.fn().mockReturnValue(chainFind([]));

    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "gameConfig") {
          return {
            findOne: vi.fn().mockResolvedValue({}),
          };
        }
        if (name === "users") {
          return { find: findMock };
        }
        return {};
      }),
    } as never);

    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.contestMode).toBe(false);
    expect(data.contest).toEqual([]);
    expect(findMock).toHaveBeenCalledTimes(1);
  });
});

describe("PATCH /api/admin/referrals/leaderboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts contest and clears rolling counts", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "admin" },
    } as never);

    const gameUpdate = vi.fn().mockResolvedValue({});
    const usersUpdate = vi.fn().mockResolvedValue({});
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "gameConfig") return { updateOne: gameUpdate };
        if (name === "users") return { updateMany: usersUpdate };
        return {};
      }),
    } as never);

    const req = new Request("http://localhost/api/admin/referrals/leaderboard", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start-contest" }),
    });

    const res = await PATCH(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.contestMode).toBe(true);
    expect(gameUpdate).toHaveBeenCalledWith(
      { _id: "default" },
      expect.objectContaining({
        $set: expect.objectContaining({ referralContestStartedAt: expect.any(Date) }),
      }),
      { upsert: true }
    );
    expect(usersUpdate).toHaveBeenCalledWith({}, { $set: { referralContestCount: 0 } });
  });

  it("ends contest and clears rolling counts", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "admin" },
    } as never);

    const gameUpdate = vi.fn().mockResolvedValue({});
    const usersUpdate = vi.fn().mockResolvedValue({});
    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "gameConfig") return { updateOne: gameUpdate };
        if (name === "users") return { updateMany: usersUpdate };
        return {};
      }),
    } as never);

    const req = new Request("http://localhost/api/admin/referrals/leaderboard", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset-contest" }),
    });

    const res = await PATCH(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.contestMode).toBe(false);
    expect(gameUpdate).toHaveBeenCalledWith(
      { _id: "default" },
      { $unset: { referralContestStartedAt: "" } },
      { upsert: true }
    );
    expect(usersUpdate).toHaveBeenCalledWith({}, { $set: { referralContestCount: 0 } });
  });

  function awardRequest(body: unknown) {
    return new Request("http://localhost/api/admin/referrals/leaderboard", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("awards the top referrers and restarts the contest", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    const { getDb } = await import("@/lib/mongodb");
    const { awardReferralContest } = await import("@/lib/contests/referralAward");
    const { createAdminLog } = await import("@/lib/adminLog");
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, admin: { username: "admin" } } as never);
    vi.mocked(getDb).mockResolvedValue({} as never);
    const restartedAt = new Date("2026-10-09T00:00:00Z");
    vi.mocked(awardReferralContest).mockResolvedValue({
      roundId: "referrals:1",
      restartedAt,
      usernames: ["alice"],
      revoked: 0,
      winners: [
        {
          rank: 1,
          characterId: "c1",
          characterName: "Alice A",
          subjectId: "u1",
          subjectName: "Alice A",
          score: 7,
          alreadySupporter: false,
        },
      ],
    });

    const res = await PATCH(awardRequest({ action: "award-and-restart" }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.contestStartedAt).toBe(restartedAt.toISOString());
    expect(data.winners).toEqual([{ rank: 1, name: "alice", count: 7, alreadySupporter: false }]);
    expect(vi.mocked(awardReferralContest).mock.calls[0][1]).toMatchObject({
      awardedBy: "admin",
    });
    expect(createAdminLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "referral_contest_awarded" })
    );
  });

  it("returns 400 for a rejected award and for an unknown action", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    const { getDb } = await import("@/lib/mongodb");
    const { awardReferralContest, ReferralAwardError } =
      await import("@/lib/contests/referralAward");
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true, admin: { username: "admin" } } as never);
    vi.mocked(getDb).mockResolvedValue({} as never);
    vi.mocked(awardReferralContest).mockRejectedValue(
      new ReferralAwardError("No referral contest is running")
    );

    const rejected = await PATCH(awardRequest({ action: "award-and-restart" }));
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error).toBe("No referral contest is running");

    const unknown = await PATCH(awardRequest({ action: "award-everyone" }));
    expect(unknown.status).toBe(400);
  });
});
