/**
 * Backfill Beta 2 characters into `retiredCharacters` for the Hall of Fame
 * leaderboard (persistent-leaderboard feature).
 *
 * The normal reset flow (resetGameWorld.ts) already retires every active
 * character with `reason: "game_reset"` before wiping. This script exists as
 * a safety net for the specific Beta 2 -> 1953-Iteration-1 transition: it
 * reads the last live mongodump taken before that wipe
 * (a local backup, 333 characters, the
 * last snapshot with real `characters` data before the collection emptied
 * out later that day) and inserts any character NOT already present in
 * `retiredCharacters` by `characterId`. If the live reset already retired
 * everyone (expected — this is a safety net, not the primary path), this is
 * a no-op.
 *
 * Idempotent: dedupes on characterId, safe to re-run.
 *
 * Dry-run (default): prints what WOULD be inserted.
 *   MONGODB_URI="$(grep '^MONGODB_URI=' .env.local | cut -d= -f2-)" \
 *     npx tsx scripts/migrations/2026-07-23-backfill-beta2-legacy-characters.ts
 * Apply: append --apply
 */
import { execFileSync } from "child_process";
import { MongoClient, ObjectId } from "mongodb";
import { EJSON } from "bson";
import { deriveHighestOffice } from "@/lib/character/deriveHighestOffice";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import type { Character } from "@/lib/db/types/character";

const BACKUP_DIR = "a local backup/a-house-divided";
const BETA2_ITERATION = { type: "Beta" as const, number: 2 };
// The backup's own mongodump timestamp — the exact wipe moment isn't
// recoverable from this source, but every backfilled row needs a stable,
// ordering-safe retiredAt so it doesn't sort as "just now" on the leaderboard.
const BACKUP_RETIRED_AT = new Date("2026-07-19T01:39:00Z");

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI not set");
const APPLY = process.argv.includes("--apply");

function dumpCollection(name: string): unknown[] {
  const raw = execFileSync("bsondump", [`${BACKUP_DIR}/${name}.bson`], {
    maxBuffer: 1024 * 1024 * 200,
  }).toString("utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => EJSON.parse(line, { relaxed: false }));
}

async function main() {
  console.log(`Reading backup at ${BACKUP_DIR} ...`);
  const backupCharacters = dumpCollection("characters") as Character[];
  const backupAchievements = dumpCollection("characterAchievements") as {
    characterId: ObjectId;
  }[];
  console.log(
    `Backup has ${backupCharacters.length} characters, ${backupAchievements.length} achievement grants.`
  );

  const achievementCountByCharacter = new Map<string, number>();
  for (const a of backupAchievements) {
    const key = String(a.characterId);
    achievementCountByCharacter.set(key, (achievementCountByCharacter.get(key) ?? 0) + 1);
  }

  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db();
  console.log(`Connected. DB = ${db.databaseName}   mode = ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  const retiredCol = db.collection("retiredCharacters");
  const usersCol = db.collection("users");

  let alreadyRetired = 0;
  const toInsert: Record<string, unknown>[] = [];
  let skippedNoUser = 0;

  for (const c of backupCharacters) {
    const existing = await retiredCol.findOne({ characterId: c._id }, { projection: { _id: 1 } });
    if (existing) {
      alreadyRetired++;
      continue;
    }

    const user = await usersCol.findOne({ _id: c.userId }, { projection: { _id: 1 } });
    if (!user) {
      // Account no longer exists (deleted since the backup) — nothing to attribute the life to.
      skippedNoUser++;
      continue;
    }

    const achievementCount = achievementCountByCharacter.get(String(c._id)) ?? 0;
    let partyName = "Independent";
    if (c.party && c.party !== "independent") {
      const partyDoc = await db
        .collection("politicalParties")
        .findOne({ sequentialId: Number(c.party), countryId: c.countryId });
      if (partyDoc) partyName = partyDoc.name as string;
    }

    toInsert.push({
      userId: c.userId,
      characterId: c._id,
      retiredAt: BACKUP_RETIRED_AT,
      reason: "game_reset",
      iteration: BETA2_ITERATION,
      snapshot: {
        name: c.name,
        countryId: c.countryId,
        homeState: c.homeState,
        party: c.party,
        partyName,
        currentOffice: c.currentOffice ?? null,
        policies: c.policies,
        demographics: c.demographics,
        stats: {
          politicalInfluence: c.politicalInfluence ?? 0,
          nationalInfluence: c.nationalInfluence ?? 0,
          partyInfluence: c.partyInfluence ?? 0,
          favorability: c.favorability ?? 50,
          infamy: c.infamy ?? 0,
          funds: c.currencyBalances?.campaign ?? c.funds ?? 0,
          // Home-currency balance, not hardcoded USD — Beta 2 had non-US
          // countries too, and a fixed USD lookup silently reads 0 for them.
          cashOnHand: c.currencyBalances?.personal?.[getHomeCurrency(c)] ?? c.cashOnHand ?? 0,
          savingsOnHand: c.currencyBalances?.savings?.[getHomeCurrency(c)] ?? c.savingsOnHand ?? 0,
        },
        avatarUrl: c.avatarUrl,
        profileHeaderImageUrl: c.profileHeaderImageUrl,
        bio: c.bio,
        careerHistory: c.careerHistory,
        highestOffice: deriveHighestOffice(c) ?? null,
        achievementCount,
        createdAt: c.createdAt,
      },
    });
  }

  console.log(`Already retired (live reset already caught these): ${alreadyRetired}`);
  console.log(`Skipped — owning account no longer exists: ${skippedNoUser}`);
  console.log(`Would insert: ${toInsert.length}`);

  if (APPLY && toInsert.length > 0) {
    const result = await retiredCol.insertMany(toInsert as never[]);
    console.log(`Inserted ${result.insertedCount} retiredCharacters docs.`);
  } else if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to write.");
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
