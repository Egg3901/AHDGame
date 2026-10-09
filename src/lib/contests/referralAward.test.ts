import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/patreon/service", () => ({ applyPatreonStatus: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));

import { awardReferralContest, ReferralAwardError } from "./referralAward";
import { applyPatreonStatus } from "@/lib/patreon/service";

const now = new Date("2026-10-09T00:00:00Z");
const until = new Date("2026-12-09T00:00:00Z");
const started = new Date("2026-08-09T00:00:00Z");

const ids = {
  paid: new ObjectId(),
  fresh: new ObjectId(),
  priorWinner: new ObjectId(),
  fourth: new ObjectId(),
  banned: new ObjectId(),
};

let db: MockDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("gameConfig").findOne.mockResolvedValue({ referralContestStartedAt: started });
  db.collection("users")
    .find()
    .toArray.mockResolvedValue([
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
        patreonExpiresAt: new Date("2026-10-20T00:00:00Z"),
        supporterProvider: "contest",
      },
      { _id: ids.fourth, username: "fourth", referralContestCount: 3 },
    ]);
  db.collection("characters")
    .find()
    .toArray.mockResolvedValue([{ _id: new ObjectId(), userId: ids.fresh, name: "Freya" }]);
  db.collection("contestRounds")
    .find()
    .toArray.mockResolvedValue([{ roundNumber: 2 }]);
});

describe("awardReferralContest", () => {
  it("awards the top three unbanned referrers and restarts the contest", async () => {
    const result = await awardReferralContest(db as unknown as Db, {
      supporterUntil: until,
      adminUsername: "staff",
      now,
    });

    expect(result.usernames).toEqual(["paid", "fresh", "prior"]);
    // The paying supporter's own plan is untouched.
    expect(applyPatreonStatus).toHaveBeenCalledTimes(2);
    expect(applyPatreonStatus).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        userId: ids.fresh,
        tier: "supporter",
        expiresAt: until,
        provider: "contest",
      })
    );
    expect(applyPatreonStatus).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ userId: ids.priorWinner, expiresAt: until, provider: "contest" })
    );
    expect(result.winners.map((w) => [w.rank, w.subjectName, w.alreadySupporter])).toEqual([
      [1, "", true],
      [2, "Freya", false],
      [3, "", false],
    ]);

    const inserted = db.collection("contestRounds").insertOne.mock.calls[0][0];
    expect(inserted).toMatchObject({
      _id: "referrals:3",
      kind: "referrals",
      status: "settled",
      startedAt: started,
    });
    expect(db.collection("gameConfig").updateOne).toHaveBeenCalledWith(
      { _id: "default" },
      { $set: { referralContestStartedAt: now } }
    );
    expect(db.collection("users").updateMany).toHaveBeenCalledWith(
      {},
      { $set: { referralContestCount: 0 } }
    );
  });

  it("refuses a past end date or a contest that is not running", async () => {
    await expect(
      awardReferralContest(db as unknown as Db, {
        supporterUntil: started,
        adminUsername: "s",
        now,
      })
    ).rejects.toBeInstanceOf(ReferralAwardError);

    db.collection("gameConfig").findOne.mockResolvedValue({});
    await expect(
      awardReferralContest(db as unknown as Db, { supporterUntil: until, adminUsername: "s", now })
    ).rejects.toThrow("No referral contest is running");
    expect(applyPatreonStatus).not.toHaveBeenCalled();
  });
});
