import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/patreon/service", () => ({ applyPatreonStatus: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));

import { awardReferralContest, ReferralAwardError } from "./referralAward";
import { applyPatreonStatus } from "@/lib/patreon/service";

const now = new Date("2026-10-09T00:00:00Z");

const ids = {
  paid: new ObjectId(),
  fresh: new ObjectId(),
  priorWinner: new ObjectId(),
  fourth: new ObjectId(),
  lapsedWinner: new ObjectId(),
};

function standing(id: ObjectId, name: string, score: number) {
  return {
    subjectId: id.toString(),
    subjectName: name,
    characterId: new ObjectId().toString(),
    characterName: name,
    baseline: 0,
    current: score,
    score,
  };
}

let db: MockDb;

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("contestRounds").findOne.mockResolvedValue({
    _id: "referrals_iteration:4",
    kind: "referrals_iteration",
    roundNumber: 4,
    status: "active",
    startedAt: new Date("2026-10-05T16:07:02Z"),
    standings: [
      standing(ids.paid, "Paige", 9),
      standing(ids.fresh, "Freya", 6),
      standing(ids.priorWinner, "Priya", 4),
      standing(ids.fourth, "Fourth", 3),
    ],
  });
  // users.find: the placed referrers, then current contest supporters.
  db.collection("users")
    .find()
    .toArray.mockResolvedValueOnce([
      {
        _id: ids.paid,
        username: "paid",
        patreonTier: "supporter-plus",
        patreonExpiresAt: null,
        supporterProvider: "patreon",
      },
      { _id: ids.fresh, username: "fresh" },
      {
        _id: ids.priorWinner,
        username: "prior",
        patreonTier: "supporter",
        patreonExpiresAt: null,
        supporterProvider: "contest",
      },
    ])
    .mockResolvedValueOnce([{ _id: ids.priorWinner }, { _id: ids.lapsedWinner }]);
  db.collection("users").updateMany.mockResolvedValue({ modifiedCount: 1 });
  db.collection("users").find.mockClear();
});

describe("awardReferralContest", () => {
  it("awards the stored top three and ends earlier contest Supporter", async () => {
    const result = await awardReferralContest(db as unknown as Db, { awardedBy: "system", now });

    expect(result.usernames).toEqual(["paid", "fresh", "prior"]);
    expect(result.roundId).toBe("referrals_iteration:4");
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
      [1, "Paige", true],
      [2, "Freya", false],
      [3, "Priya", false],
    ]);
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

    await expect(
      awardReferralContest(db as unknown as Db, { awardedBy: "staff", now })
    ).rejects.toBeInstanceOf(ReferralAwardError);
  });
});
