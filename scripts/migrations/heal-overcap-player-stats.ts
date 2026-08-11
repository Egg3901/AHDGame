/**
 * Clamp overflowed player stat caps in live data.
 *
 * Why: favorability and state politicalInfluence are game-balance-capped at 100,
 * but legacy bugs allowed some character records to drift above that maximum.
 * This script audits the live `characters` collection and, with `--apply`, heals
 * any over-cap records back down to 100 without touching values already in range.
 *
 * Usage:
 *   npx tsx scripts/migrations/heal-overcap-player-stats.ts
 *   npx tsx scripts/migrations/heal-overcap-player-stats.ts --apply
 *
 * Environment:
 *   MONGODB_URI_LIVE must be set in .env.local
 */
import { MongoClient, type Document } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const uri = process.env.MONGODB_URI_LIVE ?? null;
if (!uri) {
  console.error("MONGODB_URI_LIVE not set");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const SAMPLE_LIMIT = 20;

type CharacterOverflowRow = {
  _id?: string | { toString(): string };
  name?: string;
  favorability?: number;
  politicalInfluence?: number;
};

function formatPercent(value: number | undefined): string {
  return typeof value === "number" ? value.toFixed(1) : "n/a";
}

function summarizeOverflow(row: CharacterOverflowRow): string[] {
  const parts: string[] = [];
  if (typeof row.favorability === "number" && row.favorability > 100) {
    parts.push(`favorability ${formatPercent(row.favorability)} -> 100.0`);
  }
  if (typeof row.politicalInfluence === "number" && row.politicalInfluence > 100) {
    parts.push(`politicalInfluence ${formatPercent(row.politicalInfluence)} -> 100.0`);
  }
  return parts;
}

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();

  try {
    const db = client.db("a-house-divided");
    const filter: Document = {
      $or: [{ favorability: { $gt: 100 } }, { politicalInfluence: { $gt: 100 } }],
    };

    const matches = await db.collection<CharacterOverflowRow>("characters").find(filter).toArray();

    console.log(
      `[heal-overcap-player-stats] Found ${matches.length} player character(s) above the 100 cap.`
    );

    if (matches.length === 0) {
      return;
    }

    console.log(
      `[heal-overcap-player-stats] Mode: ${APPLY ? "apply" : "dry-run"}${APPLY ? "" : " (pass --apply to write changes)"}`
    );

    for (const row of matches.slice(0, SAMPLE_LIMIT)) {
      console.log(
        ` - ${row.name ?? "<unnamed>"} (${String(row._id ?? "")}): ${summarizeOverflow(row).join(", ")}`
      );
    }

    if (matches.length > SAMPLE_LIMIT) {
      console.log(` ... ${matches.length - SAMPLE_LIMIT} additional row(s) omitted from sample`);
    }

    if (!APPLY) {
      return;
    }

    const now = new Date();
    const result = await db.collection("characters").updateMany(filter, [
      {
        $set: {
          favorability: {
            $cond: [{ $gt: ["$favorability", 100] }, 100, "$favorability"],
          },
          politicalInfluence: {
            $cond: [{ $gt: ["$politicalInfluence", 100] }, 100, "$politicalInfluence"],
          },
          updatedAt: now,
        },
      },
    ]);

    console.log(
      `[heal-overcap-player-stats] Updated ${result.modifiedCount} character(s) (matched ${result.matchedCount}).`
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
