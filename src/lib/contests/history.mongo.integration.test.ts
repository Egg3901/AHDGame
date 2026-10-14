import { archiveRetiredCareerLegislation, loadCareerLegislation } from "@/lib/world/careerEvidence";
import { reconcileContestAchievements } from "./achievements";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadContestChampions, loadContestHistory } from "./history";
import { getContestRoundsCollection } from "./collection";
import type { ContestRound, ContestStanding } from "@/lib/db/types/contestRound";
import { migration } from "@/lib/migrations/entries/2026-10-14-contest-account-history";
import { getLegacyLeaderboardData } from "@/lib/world/legacyLeaderboard";
const uri = process.env.CONTEST_TEST_MONGO_URI;
describe.skipIf(!uri)("contest records and career ranking on isolated Mongo", () => {
  let client: MongoClient;
  let db: Db;
  const user = new ObjectId();
  const character = new ObjectId();
  const other = new ObjectId();
  const date = new Date("2026-10-01T00:00:00Z");
  const entry = (extra: Partial<ContestStanding> = {}): ContestStanding => ({
    subjectId: character.toString(),
    characterId: character.toString(),
    userId: user.toString(),
    subjectName: "Historic Company",
    characterName: "Historic Character",
    baseline: 0,
    current: 10,
    score: 10,
    ...extra,
  });
  const round = (number: number, extra: Partial<ContestRound> = {}): ContestRound => ({
    _id: `influence_gain:${number}`,
    kind: "influence_gain",
    roundNumber: number,
    status: "settled",
    startedAt: date,
    endsAt: date,
    settledAt: new Date(date.getTime() + number * 1000),
    startTurn: 1,
    iterationKey: "Beta:2",
    baselines: [],
    standings: [entry()],
    winners: [{ ...entry(), rank: 1, prizeAnchor: 100, paidAt: date }],
    ...extra,
  });
  beforeAll(async () => {
    const url = new URL(uri!);
    if (url.protocol !== "mongodb:" || !["127.0.0.1", "localhost"].includes(url.hostname))
      throw new Error("Explicit loopback test Mongo required");
    client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
  });
  beforeEach(async () => {
    db = client.db(`ahd_test_contests_${new ObjectId().toHexString()}`);
    await db.collection("users").insertMany([{ _id: user }, { _id: other }]);
  });
  afterEach(async () => {
    await db.dropDatabase();
  });
  afterAll(async () => {
    await client?.close();
  });
  it("keeps personal results across character removal and iterations, including non-winners", async () => {
    await getContestRoundsCollection(db).insertMany([
      round(1),
      round(2, {
        iterationKey: "Beta:3",
        standings: [
          entry({ userId: other.toString(), subjectId: "rival", characterId: "rival" }),
          entry(),
        ],
        winners: [],
      }),
      round(3, { status: "void" }),
      round(4, { status: "active" }),
    ]);
    const result = await loadContestHistory(db, { userId: user.toString(), characterId: null });
    expect(result.entries.map((r) => [r.roundNumber, r.rank, r.characterName])).toEqual([
      [2, 2, "Historic Character"],
      [1, 1, "Historic Character"],
    ]);
    expect(result.totals[0]).toMatchObject({ rounds: 2, wins: 1, podiums: 1, prizeAnchor: 100 });
    expect(result.iterations).toEqual(["Beta:2", "Beta:3"]);
    expect((await loadContestChampions(db))[0]).toMatchObject({ wins: 1, rounds: 2 });
  });
  it("counts a placing even when payment failed, without claiming unpaid cash", async () => {
    await getContestRoundsCollection(db).insertOne(
      round(1, { winners: [{ ...entry(), rank: 1, prizeAnchor: 100 }] })
    );
    const result = await loadContestHistory(db, { userId: user.toString(), characterId: null });
    expect(result.totals[0]).toMatchObject({ wins: 1, podiums: 1, prizeAnchor: 0 });
    expect(result.entries[0].placed).toBe(true);
  });
  it("deduplicates multi-company participation while summing all paid prizes", async () => {
    const second = entry({ subjectId: "second", subjectName: "Second Company", score: 5 });
    await getContestRoundsCollection(db).insertOne(
      round(1, {
        standings: [entry(), second],
        winners: [
          { ...entry(), rank: 1, prizeAnchor: 100, paidAt: date },
          { ...second, rank: 2, prizeAnchor: 60, paidAt: date },
        ],
      })
    );
    const result = await loadContestHistory(db, { userId: user.toString(), characterId: null });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ rank: 1, prizeAnchor: 160 });
    expect(result.totals[0]).toMatchObject({ rounds: 1, wins: 1, podiums: 1 });
  });
  it("paginates and filters rows without changing all-time totals", async () => {
    await getContestRoundsCollection(db).insertMany(
      Array.from({ length: 25 }, (_, i) =>
        round(i + 1, { iterationKey: i < 5 ? "Beta:2" : "Beta:3" })
      )
    );
    const viewer = { userId: user.toString(), characterId: null };
    expect((await loadContestHistory(db, viewer, 2)).entries).toHaveLength(5);
    const filtered = await loadContestHistory(db, viewer, 1, { iterationKey: "Beta:2" });
    expect(filtered.count).toBe(5);
    expect(filtered.entries).toHaveLength(5);
    expect(filtered.totals[0].rounds).toBe(25);
  });
  it("links legacy owners from retired records, respects dry-run and never guesses by name", async () => {
    await db.collection("retiredCharacters").insertOne({ userId: user, characterId: character });
    const legacy = entry({ userId: undefined });
    await getContestRoundsCollection(db).insertMany([
      round(1, { standings: [legacy], winners: [{ ...legacy, rank: 1 }] }),
      round(2, {
        standings: [entry({ userId: undefined, characterId: new ObjectId().toString() })],
        winners: [],
      }),
    ]);
    await migration.execute(db, { dryRun: true });
    expect(
      (await getContestRoundsCollection(db).findOne({ _id: "influence_gain:1" }))?.standings[0]
        .userId
    ).toBeFalsy();
    await migration.execute(db, { dryRun: false });
    await migration.execute(db, { dryRun: false });
    const saved = await getContestRoundsCollection(db).findOne({ _id: "influence_gain:1" });
    expect(saved?.winners[0].userId).toBe(user.toString());
    expect(
      (await getContestRoundsCollection(db).findOne({ _id: "influence_gain:2" }))?.standings[0]
        .userId
    ).toBeFalsy();
    expect(await db.collection("achievements").countDocuments()).toBe(6);
  });
  it("recalculates laws, contest results and account achievements for a replacement character", async () => {
    const replacement = new ObjectId();
    await db.collection("characters").insertOne({
      _id: replacement,
      userId: user,
      name: "New Career",
      countryId: "US",
      homeState: "CA",
      nationalInfluence: 100,
      savingsOnHand: 10_000,
    });
    await db.collection("bills").insertMany([
      { sponsorId: replacement, status: "signed", enactedAt: date },
      { sponsorId: replacement, status: "proposed" },
      { sponsorId: replacement, status: "signed", enactedAt: date, adminProposed: true },
    ]);
    const achievement = new ObjectId();
    const paidAchievement = new ObjectId();
    await db.collection("achievements").insertMany([
      { _id: achievement, category: "milestone", triggerType: "action_count" },
      { _id: paidAchievement, category: "special", triggerType: "manual_only" },
    ]);
    await db.collection("characterAchievements").insertMany([
      { userId: user, characterId: character, achievementId: achievement },
      { userId: user, characterId: character, achievementId: paidAchievement },
    ]);
    await getContestRoundsCollection(db).insertOne(
      round(1, {
        standings: [entry({ characterId: replacement.toString() })],
        winners: [{ ...entry({ characterId: replacement.toString() }), rank: 1 }],
      })
    );
    const data = await getLegacyLeaderboardData(db, { userId: user.toString() });
    const career = data.entries[0];
    expect(career.achievementCount).toBe(1);
    expect(career.enactedBills).toBe(1);
    expect(career.contestWins).toBe(1);
    for (const key of ["wealth", "legislation", "contests", "achievements"] as const)
      expect(career.scoreBreakdown[key]).toBeGreaterThan(0);
  });
  it("reconciles achievements after character removal and retries without duplicate awards", async () => {
    await migration.execute(db, { dryRun: false });
    await getContestRoundsCollection(db).insertMany([round(1), round(2), round(3)]);
    await reconcileContestAchievements(db);
    await reconcileContestAchievements(db);
    const earned = await db.collection("characterAchievements").find({ userId: user }).toArray();
    expect(earned).toHaveLength(4);
    const definitions = await db
      .collection("achievements")
      .find({ _id: { $in: earned.map((e) => e.achievementId) } })
      .toArray();
    expect(definitions.map((d) => d.slug)).toContain("contest_winning_streak");
    await db.collection("users").updateOne({ _id: user }, { $set: { isBanned: true } });
    await reconcileContestAchievements(db);
    expect(await db.collection("characterAchievements").countDocuments({ userId: user })).toBe(4);
  });
  it("preserves laws enacted after a sponsor retires, before bill collections are reset", async () => {
    await db.collection("retiredCharacters").insertOne({
      userId: user,
      characterId: character,
      snapshot: { stats: { enactedBills: 1 } },
    });
    await db
      .collection("bills")
      .insertMany([1, 2].map(() => ({ sponsorId: character, status: "signed", enactedAt: date })));
    await archiveRetiredCareerLegislation(db, await loadCareerLegislation(db));
    await db.collection("bills").deleteMany({});
    expect(
      (await db.collection("retiredCharacters").findOne({ characterId: character }))?.snapshot.stats
        .enactedBills
    ).toBe(2);
  });
  it("does not award business points for borrowed cash", async () => {
    await db.collection("characters").insertOne({
      _id: character,
      userId: user,
      name: "Borrowed Career",
      countryId: "US",
      homeState: "CA",
      cashOnHand: 1_000_000,
    });
    await db.collection("bankLoans").insertMany([
      {
        borrowerType: "character",
        borrowerId: character,
        currency: "USD",
        outstanding: 1_000_000,
        status: "current",
      },
      {
        borrowerType: "character",
        borrowerId: character,
        currency: "USD",
        outstanding: 100_000,
        status: "pending",
      },
    ]);
    const career = (await getLegacyLeaderboardData(db, null)).entries[0];
    expect(career.netWorth).toBe(0);
    expect(career.netWorthBreakdown.debt).toBe(-1_000_000);
    expect(career.scoreBreakdown.wealth).toBe(0);
  });
});
