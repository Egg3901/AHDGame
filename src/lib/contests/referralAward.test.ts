import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/patreon/service", () => ({ applyPatreonStatus: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));

import { awardReferralContest, ReferralAwardError } from "./referralAward";
import { applyPatreonStatus } from "@/lib/patreon/service";

const now = new Date("2026-10-09T00:00:00Z");
const started = new Date("2026-08-09T00:00:00Z");

const ids = {
  paid: new ObjectId(),
  fresh: new ObjectId(),
  priorWinner: new ObjectId(),
  fourth: new ObjectId(),
  banned: new ObjectId(),
  lapsedWinner: new ObjectId(),
};

let db: MockDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("gameConfig").findOne.mockResolvedValue({ referralContestStartedAt: started });
  db.collection("contestRounds").findOne.mockResolvedValue({
    _id: "referrals_iteration:4",
    kind: "referrals_iteration",
    roundNumber: 4,
    status: "active",
    startedAt: started,
    iterationKey: "Beta:2",
  });
  const leaders = [
    { _id: ids.banned, username: "banned", referralContestCount: 50, isBanned: true },
    {
      _id: ids.paid,
      username: "paid",
      referralContestCount: 9,
      patreonTier: "supporter-plus",
      patreonExpiresAt: null,
      supporterProvider: "patreon",
    },
    { _id: ids.fresh, username: "fresh", referralContestCount: 6 },
    {
      _id: ids.priorWinner,
      username: "prior",
      referralContestCount: 4,
      patreonTier: "supporter",
      patreonExpiresAt: null,
      supporterProvider: "contest",
    },
    { _id: ids.fourth, username: "fourth", referralContestCount: 3 },
  ];
  // users.find is called for the leaderboard, then for current contest supporters.
  db.collection("users")
    .find()
    .toArray.mockResolvedValueOnce(leaders)
    .mockResolvedValueOnce([{ _id: ids.priorWinner }, { _id: ids.lapsedWinner }]);
  db.collection("users").updateMany.mockResolvedValue({ modifiedCount: 1 });
  db.collection("characters")
    .find()
    .toArray.mockResolvedValue([{ _id: new ObjectId(), userId: ids.fresh, name: "Freya" }]);
  db.collection("users").find.mockClear();
});

describe("awardReferralContest", () => {
  it("awards the top three, ends earlier contest Supporter, and restarts the count", async () => {
    const result = await awardReferralContest(db as unknown as Db, { awardedBy: "staff", now });

    expect(result.usernames).toEqual(["paid", "fresh", "prior"]);
    expect(result.roundId).toBe("referrals_iteration:4");

    // The round is claimed before anyone's benefits change.
    expect(db.collection("contestRounds").updateOne).toHaveBeenCalledWith(
      { _id: "referrals_iteration:4", status: "active" },
      { $set: { status: "settled", settledAt: now, endsAt: now } }
    );

    // The paying supporter's plan is untouched; the rest get Supporter with no end date.
    expect(vi.mocked(applyPatreonStatus).mock.calls.map((c) => c[1].userId)).toEqual([
      ids.fresh,
      ids.priorWinner,
    ]);
    expect(vi.mocked(applyPatreonStatus).mock.calls[0][1]).toMatchObject({
      tier: "supporter",
      expiresAt: null,
      provider: "contest",
    });

    // Only the earlier winner who did not place again loses contest Supporter.
    expect(db.collection("users").updateMany).toHaveBeenCalledWith(
      { _id: { $in: [ids.lapsedWinner] }, supporterProvider: "contest" },
      expect.objectContaining({
        $set: { patreonTier: null, supporterProvider: null, patreonExpiresAt: now },
      })
    );

    expect(result.winners.map((w) => [w.rank, w.subjectName, w.alreadySupporter])).toEqual([
      [1, "", true],
      [2, "Freya", false],
      [3, "", false],
    ]);
    expect(db.collection("users").updateMany).toHaveBeenCalledWith(
      {},
      { $set: { referralContestCount: 0 } }
    );
    expect(db.collection("contestRounds").insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "referrals_iteration:5",
        status: "active",
        startedAt: now,
        iterationKey: "Beta:2",
      })
    );
  });

  it("refuses a second award of the same contest", async () => {
    db.collection("contestRounds").updateOne.mockResolvedValueOnce({ modifiedCount: 0 });

    await expect(
      awardReferralContest(db as unknown as Db, { awardedBy: "staff", now })
    ).rejects.toThrow("already awarded");
    expect(applyPatreonStatus).not.toHaveBeenCalled();
  });

  it("refuses when no referral contest is running", async () => {
    db.collection("contestRounds").findOne.mockResolvedValue(null);
    db.collection("gameConfig").findOne.mockResolvedValue({});

    await expect(
      awardReferralContest(db as unknown as Db, { awardedBy: "staff", now })
    ).rejects.toBeInstanceOf(ReferralAwardError);
  });
});
