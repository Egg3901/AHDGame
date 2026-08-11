/**
 * Migration: Backfill NPP avatars, gender, and ethnicity
 * Assigns avatarUrl, gender, and ethnicity to all NPPs that don't have them.
 * Uses the same image pool and selection logic as the dynamic NPP generator.
 */

import { connectDb, closeDb } from "../utils/db";
import * as fs from "fs";
import * as path from "path";

// ── Image pool ────────────────────────────────────────────────────────────────

interface PoliticianImage {
  id: string;
  name: string;
  country: string;
  gender: string;
  ethnicity: string;
}

function loadImages(): PoliticianImage[] {
  const filePath = path.join(process.cwd(), "src/data/npp-politician-images.json");
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as PoliticianImage[];
}

// ── Ethnicity weights (mirrors generator.ts) ──────────────────────────────────

const ETHNICITY_WEIGHTS: Record<string, Array<[string, number]>> = {
  US: [
    ["white", 60],
    ["hispanic", 18],
    ["black", 13],
    ["asian", 6],
    ["other", 3],
  ],
  UK: [
    ["white", 81],
    ["asian", 7],
    ["other", 7],
    ["black", 3],
    ["hispanic", 2],
  ],
};

const DEFAULT_WEIGHTS: Array<[string, number]> = [
  ["white", 70],
  ["black", 10],
  ["hispanic", 10],
  ["asian", 8],
  ["other", 2],
];

function weightedRandomEthnicity(countryId: string): string {
  const weights = ETHNICITY_WEIGHTS[countryId] ?? DEFAULT_WEIGHTS;
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [value, weight] of weights) {
    r -= weight;
    if (r <= 0) return value;
  }
  return weights[0][0];
}

function selectImage(
  images: PoliticianImage[],
  countryId: string,
  gender: string,
  ethnicity: string,
  nppName: string
): string | undefined {
  const nameLower = nppName.toLowerCase();
  const pool = images.filter((p) => p.country === countryId && p.name.toLowerCase() !== nameLower);
  if (pool.length === 0) return undefined;

  const byBoth = pool.filter((p) => p.gender === gender && p.ethnicity === ethnicity);
  const byGender = byBoth.length > 0 ? byBoth : pool.filter((p) => p.gender === gender);
  const candidates = byGender.length > 0 ? byGender : pool;

  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  return `/api/images/npp-politicians/${chosen.id}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function migrate() {
  console.log("Starting NPP avatar backfill...");
  const db = await connectDb();
  const images = loadImages();
  console.log(`Loaded ${images.length} politician images`);

  // Find all NPPs missing an avatarUrl
  const npps = await db
    .collection("npps")
    .find({ avatarUrl: { $exists: false } })
    .project({ _id: 1, name: 1, countryId: 1, gender: 1, ethnicity: 1 })
    .toArray();

  console.log(`Found ${npps.length} NPPs without avatars`);
  if (npps.length === 0) {
    await closeDb();
    console.log("Nothing to do.");
    return;
  }

  let updated = 0;
  let skipped = 0;

  for (const npp of npps) {
    const gender = (npp.gender as string) ?? (Math.random() < 0.5 ? "male" : "female");
    const ethnicity = (npp.ethnicity as string) ?? weightedRandomEthnicity(npp.countryId as string);
    const avatarUrl = selectImage(
      images,
      npp.countryId as string,
      gender,
      ethnicity,
      npp.name as string
    );

    if (!avatarUrl) {
      skipped++;
      continue;
    }

    await db
      .collection("npps")
      .updateOne(
        { _id: npp._id },
        { $set: { gender, ethnicity, avatarUrl, updatedAt: new Date() } }
      );
    updated++;
  }

  console.log(`Updated: ${updated}, Skipped (no image pool): ${skipped}`);
  await closeDb();
  console.log("Done.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
