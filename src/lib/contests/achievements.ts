import { createHash } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import type { Achievement, CharacterAchievement } from "@/lib/db/types";
import { invalidateRarityCache } from "@/lib/achievements/cache";
import { getContestRoundsCollection } from "./collection";
import { contestAchievementMilestones, type ContestPlacing } from "./rules/history";

/** Reconcile from durable results, with batched reads/writes and retry-safe ids. */
export async function reconcileContestAchievements(
  db: Db,
  userIds?: readonly string[]
): Promise<void> {
  if (userIds?.length === 0) return;
  const records = await getContestRoundsCollection(db)
    .aggregate<{
      _id: string;
      placings: Array<ContestPlacing & { characterId?: string | null }>;
    }>([
      {
        $match: {
          status: "settled",
          "winners.userId": userIds ? { $in: userIds } : { $type: "string" },
        },
      },
      { $unwind: "$winners" },
      {
        $match: {
          "winners.userId": userIds ? { $in: userIds } : { $type: "string" },
          "winners.score": { $gt: 0 },
        },
      },
      { $sort: { settledAt: 1, roundNumber: 1, _id: 1 } },
      {
        $group: {
          _id: "$winners.userId",
          placings: {
            $push: {
              characterId: {
                $cond: [{ $eq: [{ $type: "$settledAt" }, "date"] }, "$winners.characterId", null],
              },
              kind: "$kind",
              roundNumber: "$roundNumber",
              iterationKey: "$iterationKey",
              rank: { $ifNull: ["$winners.rank", 1] },
            },
          },
        },
      },
    ])
    .toArray();
  if (records.length === 0) return;
  const owners = records.filter((r) => ObjectId.isValid(r._id)).map((r) => new ObjectId(r._id));
  const [definitions, existing, users] = await Promise.all([
    db.collection<Achievement>("achievements").find({}).toArray(),
    db
      .collection<CharacterAchievement>("characterAchievements")
      .find({ userId: { $in: owners } }, { projection: { userId: 1, achievementId: 1 } })
      .toArray(),
    db
      .collection("users")
      .find({ _id: { $in: owners }, isBanned: { $ne: true } }, { projection: { _id: 1 } })
      .toArray(),
  ]);
  const eligibleOwners = new Set(users.map((u) => u._id.toString()));
  const have = new Map<string, Set<string>>();
  for (const row of existing) {
    const ids = have.get(row.userId.toString()) ?? new Set<string>();
    ids.add(row.achievementId.toString());
    have.set(row.userId.toString(), ids);
  }
  const bySlug = new Map(definitions.map((d) => [d.slug, d]));
  const now = new Date();
  const docs: CharacterAchievement[] = [];
  const add = (userId: string, slug: string, characterId: string | undefined) => {
    const definition = bySlug.get(slug);
    if (!definition) return;
    const earned = have.get(userId) ?? new Set<string>();
    if (earned.has(definition._id.toString())) return;
    earned.add(definition._id.toString());
    have.set(userId, earned);
    docs.push({
      _id: new ObjectId(
        createHash("sha256")
          .update(`contest-achievement:${userId}:${definition._id}`)
          .digest("hex")
          .slice(0, 24)
      ),
      userId: new ObjectId(userId),
      achievementId: definition._id,
      ...(characterId && ObjectId.isValid(characterId)
        ? { characterId: new ObjectId(characterId) }
        : {}),
      earnedAt: now,
    });
  };
  const required = definitions
    .filter((d) => d.slug !== "completionist")
    .map((d) => d._id.toString());
  for (const record of records) {
    if (!eligibleOwners.has(record._id)) continue;
    for (const milestone of contestAchievementMilestones(record.placings))
      add(record._id, milestone.slug, milestone.characterId);
    if (required.length > 0 && required.every((id) => have.get(record._id)?.has(id)))
      add(record._id, "completionist", record.placings.at(-1)?.characterId ?? undefined);
  }
  if (docs.length === 0) return;
  await db.collection<CharacterAchievement>("characterAchievements").bulkWrite(
    docs.map((doc) => ({
      updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true },
    })),
    { ordered: false }
  );
  invalidateRarityCache();
}
