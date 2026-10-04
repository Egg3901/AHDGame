/**
 * Season Recap ("Wrapped") tooling.
 *
 *   npx tsx scripts/recap/season-recap.ts preview [--out file.json]
 *     Read-only. Builds every current character's recap from MONGODB_URI exactly
 *     as a reset would, prints a coverage summary and optionally writes the
 *     recaps as JSON (fixtures for the story UI).
 *
 *   npx tsx scripts/recap/season-recap.ts backfill --source-uri <uri> [--write] [--reshow]
 *     For a reset that ran on older code: builds recaps from a restored
 *     pre-reset dump (`--source-uri`, never the live database) and stamps them
 *     onto the matching `retiredCharacters` rows in MONGODB_URI. Dry run unless
 *     `--write`. `--reshow` clears `recapViewedAt` so the post-reset gate shows
 *     the new recap to players who already watched the old one.
 */
import { writeFileSync } from "node:fs";
import { MongoClient, ObjectId } from "mongodb";
import type { Character, GameState } from "@/lib/db/types";
import type { RetiredCharacter } from "@/lib/db/types/retiredCharacter";
import { buildSeasonRecaps } from "@/lib/recap/buildSeasonRecaps";
import type { CharacterRecap } from "@/lib/recap/types";
import { closeDb, connectDb } from "../utils/db";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(name);

async function buildAll(db: Awaited<ReturnType<typeof connectDb>>) {
  const gs = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { iteration: 1, currentTurn: 1 } });
  const chars = await db.collection<Character>("characters").find({}).toArray();
  const started = Date.now();
  const recaps = await buildSeasonRecaps(
    db,
    chars,
    { iteration: gs?.iteration, currentTurn: gs?.currentTurn ?? 1 },
    { log: (m) => console.warn(m) }
  );
  console.log(`built ${recaps.size} recaps in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return { gs, recaps };
}

function summarize(recaps: Map<string, CharacterRecap>) {
  const all = [...recaps.values()];
  const has = (pick: (r: CharacterRecap) => unknown) => all.filter((r) => Boolean(pick(r))).length;
  const sizes = all.map((r) => JSON.stringify(r).length).sort((a, b) => a - b);
  console.table({
    activity: has((r) => r.activity),
    climb: has((r) => r.climb?.length),
    races: has((r) => r.races),
    bestWin: has((r) => r.races?.bestWin),
    closest: has((r) => r.races?.closest),
    rival: has((r) => r.races?.rival),
    legislation: has((r) => r.legislation),
    signatureBill: has((r) => r.legislation?.signature),
    decisive: has((r) => r.legislation?.decisive.length),
    wealth: has((r) => r.wealth),
    corporation: has((r) => r.corporation),
    awards: has((r) => r.awards?.length),
    world: has((r) => r.world),
  });
  const personas: Record<string, number> = {};
  for (const r of all)
    personas[r.persona?.key ?? "none"] = (personas[r.persona?.key ?? "none"] ?? 0) + 1;
  console.log("personas", personas);
  console.log(
    `doc size bytes: median ${sizes[Math.floor(sizes.length / 2)] ?? 0}, max ${sizes.at(-1) ?? 0}`
  );
}

async function preview() {
  const db = await connectDb();
  const { recaps } = await buildAll(db);
  summarize(recaps);
  const out = arg("--out");
  if (out) {
    writeFileSync(out, JSON.stringify([...recaps.values()], null, 2));
    console.log(`wrote ${out}`);
  }
}

async function backfill() {
  const sourceUri = arg("--source-uri");
  if (!sourceUri) throw new Error("--source-uri <restored pre-reset dump> is required");
  if (sourceUri === process.env.MONGODB_URI) throw new Error("source and target must differ");
  const source = new MongoClient(sourceUri);
  await source.connect();
  try {
    const { gs, recaps } = await buildAll(source.db());
    summarize(recaps);
    const target = await connectDb();
    const rows = await target
      .collection<RetiredCharacter>("retiredCharacters")
      .find(
        {
          characterId: { $in: [...recaps.keys()].map((id) => new ObjectId(id)) },
          ...(gs?.iteration ? { iteration: gs.iteration } : {}),
        },
        { projection: { characterId: 1, "recap.schemaVersion": 1 } }
      )
      .toArray();
    const stale = rows.filter((r) => r.recap?.schemaVersion !== 2);
    console.log(`${rows.length} matching retired rows, ${stale.length} without a v2 recap`);
    if (!flag("--write")) {
      console.log("dry run; pass --write to stamp");
      return;
    }
    let written = 0;
    for (const row of stale) {
      const recap = recaps.get(String(row.characterId));
      if (!recap) continue;
      const res = await target.collection<RetiredCharacter>("retiredCharacters").updateOne(
        { _id: row._id },
        {
          $set: { recap },
          ...(flag("--reshow") ? { $unset: { recapViewedAt: "" } } : {}),
        }
      );
      written += res.modifiedCount;
    }
    console.log(`stamped ${written} recaps`);
  } finally {
    await source.close();
  }
}

const mode = process.argv[2];
(mode === "backfill"
  ? backfill()
  : mode === "preview"
    ? preview()
    : Promise.reject(new Error("mode: preview | backfill"))
)
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
