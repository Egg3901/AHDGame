/**
 * Backfill: convert relative avatar upload paths to absolute URLs.
 *
 * Avatars uploaded while the server ran in local-storage mode (Cloudflare R2
 * disabled) were persisted as root-relative paths, e.g.
 *   /api/uploads/avatars/<id>-<ts>.webp
 * Relative URLs are rejected by Discord's embed-builder URL validator, which
 * surfaced as a "/profile — connection failed" error in the Discord bot.
 *
 * The discord-bot API routes already absolutise these at the response boundary
 * (defence-in-depth), and the avatar upload route now stores absolute URLs going
 * forward. This script cleans up existing rows so the stored data is consistent.
 *
 * Operates on the database pointed to by MONGODB_URI in .env.local — point it at
 * the intended environment before running. Dry-run by default; idempotent
 * (already-absolute URLs are skipped).
 *
 * Usage:
 *   npx tsx scripts/backfill-absolute-avatar-urls.ts            # dry run
 *   npx tsx scripts/backfill-absolute-avatar-urls.ts --apply    # write changes
 */

import type { ObjectId } from "mongodb";
import { connectDb, closeDb } from "./utils/db";
import { toAbsoluteUploadUrl } from "../src/lib/discord";

const apply = process.argv.includes("--apply");
const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") || "https://ahousedividedgame.com";

// Match values that are root-relative upload paths (need absolutising).
// Already-absolute (http/https) and empty values are left untouched.
const RELATIVE_UPLOAD = /^\/api\/uploads\//;

type AvatarRow = { _id: ObjectId; name?: string; avatarUrl?: string | null };

async function backfillCollection(
  db: Awaited<ReturnType<typeof connectDb>>,
  collectionName: string
): Promise<{ scanned: number; updated: number }> {
  const rows = (await db
    .collection(collectionName)
    .find({ avatarUrl: { $regex: RELATIVE_UPLOAD } })
    .project({ name: 1, avatarUrl: 1 })
    .toArray()) as AvatarRow[];

  let updated = 0;
  for (const row of rows) {
    const absolute = toAbsoluteUploadUrl(row.avatarUrl, BASE_URL);
    if (!absolute || absolute === row.avatarUrl) continue; // no-op safety
    if (apply) {
      await db
        .collection(collectionName)
        .updateOne({ _id: row._id }, { $set: { avatarUrl: absolute, updatedAt: new Date() } });
    }
    console.log(
      `  ${apply ? "✓" : "[dry]"} ${collectionName}: ${row.name ?? row._id} → ${absolute}`
    );
    updated++;
  }

  return { scanned: rows.length, updated };
}

async function main() {
  const db = await connectDb();
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Mode: ${apply ? "APPLY (writing)" : "DRY RUN (no writes)"}\n`);

  let totalScanned = 0;
  let totalUpdated = 0;
  for (const collectionName of ["characters", "imperialCharacters"]) {
    const { scanned, updated } = await backfillCollection(db, collectionName);
    console.log(
      `${collectionName}: ${scanned} relative avatar(s) found, ${updated} ${apply ? "updated" : "would update"}.`
    );
    totalScanned += scanned;
    totalUpdated += updated;
  }

  console.log(
    `\nDone: ${totalUpdated}/${totalScanned} avatar URL(s) ${apply ? "updated" : "would be updated"}.`
  );
  if (!apply && totalUpdated > 0) {
    console.log("Re-run with --apply to write the changes.");
  }
}

main()
  .then(() => closeDb())
  .catch((err) => {
    console.error(err);
    closeDb();
    process.exit(1);
  });
