/**
 * Backfill "At the President's Table" (cabinet_seat) for accounts whose
 * characters were appointed to a cabinet but never opened their profile while
 * seated, which was the only time the old check ran.
 *
 * Sources: `careerHistory` appointments on live characters and on the snapshot of
 * retired characters. Central bank chairs leave no career event, so that
 * achievement is covered going forward by the turn sweep only.
 *
 * Idempotent: an account that already holds the achievement is skipped.
 * Dry run by default; pass --apply to write.
 *
 * Usage:
 *   npx tsx scripts/backfill-cabinet-seat-achievement.ts [--apply]
 */
import { ObjectId } from "mongodb";
import { connectDb, closeDb } from "./utils/db";

const CABINET_OFFICE_TYPES = ["usCabinet", "ukCabinet", "parliamentaryCabinet"];

interface Candidate {
  userId: ObjectId;
  characterId: ObjectId;
  earnedAt: Date;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = await connectDb();

  const definition = await db
    .collection<{ _id: ObjectId; slug: string }>("achievements")
    .findOne({ slug: "cabinet_seat" });
  if (!definition) throw new Error("cabinet_seat achievement definition not found");

  const appointed = {
    $elemMatch: { type: "appointed", "office.type": { $in: CABINET_OFFICE_TYPES } },
  };
  const earliestAppointment = (
    history: Array<{ type: string; office?: { type: string }; date: Date }>
  ) =>
    history
      .filter(
        (e) => e.type === "appointed" && e.office && CABINET_OFFICE_TYPES.includes(e.office.type)
      )
      .map((e) => new Date(e.date))
      .sort((a, b) => a.getTime() - b.getTime())[0];

  const byUser = new Map<string, Candidate>();
  const consider = (userId: ObjectId, characterId: ObjectId, earnedAt: Date | undefined) => {
    if (!earnedAt) return;
    const key = userId.toString();
    const prior = byUser.get(key);
    if (!prior || earnedAt < prior.earnedAt) byUser.set(key, { userId, characterId, earnedAt });
  };

  const live = db
    .collection("characters")
    .find({ careerHistory: appointed }, { projection: { userId: 1, careerHistory: 1 } });
  for await (const c of live) consider(c.userId, c._id, earliestAppointment(c.careerHistory ?? []));

  const retired = db
    .collection("retiredCharacters")
    .find(
      { "snapshot.careerHistory": appointed },
      { projection: { userId: 1, characterId: 1, "snapshot.careerHistory": 1 } }
    );
  for await (const r of retired) {
    consider(r.userId, r.characterId, earliestAppointment(r.snapshot?.careerHistory ?? []));
  }

  const candidates = [...byUser.values()];
  const have = new Set(
    (
      await db
        .collection("characterAchievements")
        .find(
          { achievementId: definition._id, userId: { $in: candidates.map((c) => c.userId) } },
          { projection: { userId: 1 } }
        )
        .toArray()
    ).map((d) => d.userId.toString())
  );
  const missing = candidates.filter((c) => !have.has(c.userId.toString()));

  console.log(`Accounts with a cabinet appointment on record: ${candidates.length}`);
  console.log(`Already hold cabinet_seat: ${candidates.length - missing.length}`);
  console.log(`To award: ${missing.length}`);

  if (apply && missing.length > 0) {
    await db.collection("characterAchievements").insertMany(
      missing.map((m) => ({
        _id: new ObjectId(),
        userId: m.userId,
        characterId: m.characterId,
        achievementId: definition._id,
        earnedAt: m.earnedAt,
        grantedBy: null,
      })),
      { ordered: false }
    );
    console.log(`Inserted ${missing.length} awards.`);
  } else if (!apply) {
    console.log("DRY RUN: no changes written. Pass --apply to write.");
  }

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
