/**
 * Cap non-members' opening alignment at 50 in an ALREADY-SEEDED world.
 *
 *   npx tsx scripts/backfill-alignment-nonmember-cap.ts                 # dry-run
 *   npx tsx scripts/backfill-alignment-nonmember-cap.ts --apply         # write
 *   npx tsx scripts/backfill-alignment-nonmember-cap.ts --live          # target LIVE
 *   npx tsx scripts/backfill-alignment-nonmember-cap.ts --max-turn 48   # widen the guard
 *
 * `seedCountryAlignments` never touches a row that already exists, so a world
 * seeded before the cap keeps the shares it opened with — South Korea at 84
 * toward the West, Cuba at 78 — and those nations apply to NATO on their own.
 * This trims them to the same 50 a fresh world would now start them at.
 *
 * WHY IT IS TURN-GUARDED. The cap is an opening-position rule, not a ceiling: a
 * nation is MEANT to pass 50 once a player has spent on it. Rewriting shares in
 * a world that has been played would confiscate that work, so this refuses to
 * run past `--max-turn` (default 24, half a game year) unless told otherwise.
 *
 * Only shares ABOVE the cap in a bloc's own pole are touched, and only for
 * non-members of that bloc. The trimmed points go to the remainder — non-
 * alignment — never to the rival pole. Rows already at or below the cap, and
 * every member row, are left exactly as they are. Idempotent.
 *
 * Targets MONGODB_URI (testing) unless `--live` is passed.
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import { polesForYear, resolveAlignmentEra } from "../src/lib/constants/alignmentEras";
import { INTERNATIONAL_ORGANIZATIONS } from "../src/lib/constants/internationalOrganizations";
import { resolveSeedRoster } from "../src/lib/internationalOrganizations/founding";
import { DEFAULT_PRESET, PRESET_YEAR } from "../src/lib/constants/alignmentSeeds";
import { normalizeShares } from "../src/lib/alignment/normalize";

dotenv.config({ path: ".env.local" });

const NON_MEMBER_SEED_CAP = 50;

const apply = process.argv.includes("--apply");
const live = process.argv.includes("--live");
const maxTurnArg = process.argv.indexOf("--max-turn");
const MAX_TURN = maxTurnArg >= 0 ? Number(process.argv[maxTurnArg + 1]) : 24;

async function main() {
  const uri = live ? process.env.MONGODB_URI_LIVE : process.env.MONGODB_URI;
  if (!uri) throw new Error(live ? "MONGODB_URI_LIVE is not set" : "MONGODB_URI is not set");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  try {
    const state = await db
      .collection<{ preset?: string; currentTurn?: number }>("gameState")
      .findOne({});
    const preset = state?.preset ?? DEFAULT_PRESET;
    const turn = state?.currentTurn ?? 0;
    const year = PRESET_YEAR[preset] ?? PRESET_YEAR[DEFAULT_PRESET];
    const poles = polesForYear(year);

    console.log(`target      ${live ? "LIVE" : "TESTING"}`);
    console.log(`preset      ${preset} (year ${year})`);
    console.log(`turn        ${turn}\n`);

    if (turn > MAX_TURN) {
      console.log(
        `REFUSING: turn ${turn} is past --max-turn ${MAX_TURN}. This world has been\n` +
          `played, and shares above ${NON_MEMBER_SEED_CAP} may have been bought rather than seeded.\n` +
          `Re-run with --max-turn ${turn} only if you are certain that is what you want.`
      );
      return;
    }

    // pole → the set of entities that are members of the bloc channelling to it.
    const membersByPole = new Map<string, Set<string>>();
    for (const channel of resolveAlignmentEra(year).channels) {
      if (!channel.alignmentAccession) continue;
      const def =
        INTERNATIONAL_ORGANIZATIONS[
          channel.organizationId as keyof typeof INTERNATIONAL_ORGANIZATIONS
        ];
      if (!def) continue;
      membersByPole.set(
        channel.poleId,
        new Set(resolveSeedRoster(def, preset).map((m) => String(m)))
      );
    }
    if (membersByPole.size === 0) {
      console.log("This era has no alignment-accession blocs. Nothing to cap.");
      return;
    }
    for (const [pole, members] of membersByPole) {
      console.log(`${pole.padEnd(12)} ${members.size} members exempt`);
    }
    console.log();

    const col = db.collection<{
      entityId: string;
      shares: Record<string, number>;
      nonAligned: number;
    }>("countryAlignments");
    const rows = await col.find({}).toArray();

    const changes: { entityId: string; pole: string; from: number; to: number; na: number }[] = [];
    for (const row of rows) {
      const raw: Record<string, number> = { ...row.shares };
      let touched = false;
      for (const [pole, members] of membersByPole) {
        if (members.has(row.entityId)) continue;
        const current = raw[pole] ?? 0;
        if (current <= NON_MEMBER_SEED_CAP) continue;
        raw[pole] = NON_MEMBER_SEED_CAP;
        touched = true;
        changes.push({
          entityId: row.entityId,
          pole,
          from: current,
          to: NON_MEMBER_SEED_CAP,
          na: row.nonAligned,
        });
      }
      if (!touched) continue;

      // The single write path, so the trimmed points land in the remainder and
      // the row still totals exactly 100.
      const next = normalizeShares(raw as never, poles);
      if (apply) {
        await col.updateOne(
          { entityId: row.entityId },
          { $set: { shares: next.shares, nonAligned: next.nonAligned, updatedAt: new Date() } }
        );
      }
      const last = changes[changes.length - 1]!;
      last.na = next.nonAligned;
    }

    changes.sort((a, b) => b.from - a.from);
    for (const c of changes) {
      console.log(
        `  ${c.entityId.padEnd(5)} ${c.pole.padEnd(6)} ${String(c.from).padStart(5)} → ${String(c.to).padStart(3)}   remainder now ${c.na}`
      );
    }
    console.log(
      `\n${changes.length} share(s) over the cap across ${rows.length} rows.` +
        (apply ? " APPLIED." : " Dry run — re-run with --apply to write.")
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
