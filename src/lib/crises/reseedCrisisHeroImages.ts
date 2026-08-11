import type { Db } from "mongodb";
import type { Crisis } from "@/lib/db/types/crisis";
import { ALL_CRISIS_TEMPLATES } from "./templates";

/** Map crisis display name → template hero image URL. First template wins on duplicates. */
export function buildHeroImageByCrisisName(): Map<string, string> {
  const map = new Map<string, string>();
  for (const template of Object.values(ALL_CRISIS_TEMPLATES)) {
    if (template.heroImage && !map.has(template.name)) {
      map.set(template.name, template.heroImage);
    }
  }
  return map;
}

export interface ReseedCrisisHeroImagesResult {
  updated: number;
  alreadyCorrect: number;
  unmatched: string[];
}

/**
 * Backfill `heroImage` on existing crisis documents from the current template
 * catalog (matched by `name`). Manual crises with no matching template are
 * reported in `unmatched` and left unchanged.
 */
export async function reseedCrisisHeroImages(db: Db): Promise<ReseedCrisisHeroImagesResult> {
  const byName = buildHeroImageByCrisisName();
  const crises = await db.collection<Crisis>("crises").find({}).toArray();

  let updated = 0;
  let alreadyCorrect = 0;
  const unmatched = new Set<string>();

  for (const crisis of crises) {
    const heroImage = byName.get(crisis.name);
    if (!heroImage) {
      unmatched.add(crisis.name);
      continue;
    }
    if (crisis.heroImage === heroImage) {
      alreadyCorrect++;
      continue;
    }
    await db.collection<Crisis>("crises").updateOne({ _id: crisis._id }, { $set: { heroImage } });
    updated++;
  }

  return { updated, alreadyCorrect, unmatched: [...unmatched].sort() };
}
