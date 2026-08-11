/**
 * Phase 11b — executive political impact at sovereign-default resolution.
 *
 * Calibration anchored to real-world post-default incumbent outcomes:
 *   - Repudiate: largest hit (-20 fav / +15 infamy). Defaulting outright is
 *     historically a career-ender (Argentina 2001 → Duhalde / De la Rua etc.).
 *   - Monetize: -15 / +10. Inflation always wrecks incumbents (Erdogan-style
 *     tail risk; Peronist Argentina 2019).
 *   - Bailout: -10 / +5. Less severe but austerity backlash is real
 *     (Sarkozy/Greek bailouts, Macri/IMF deal).
 *   - Restructure: -8 / +5. Compromise tax — least bad option.
 */

import type { Db, ObjectId } from "mongodb";
import type { Character } from "@/lib/db/types";
import type { SovereignResolutionChoice } from "@/lib/db/types/budget";

export interface ExecutivePoliticalImpact {
  favorabilityDelta: number;
  infamyDelta: number;
}

const IMPACT_BY_PATH: Record<SovereignResolutionChoice, ExecutivePoliticalImpact> = {
  repudiate: { favorabilityDelta: -20, infamyDelta: 15 },
  monetize: { favorabilityDelta: -15, infamyDelta: 10 },
  bailout: { favorabilityDelta: -10, infamyDelta: 5 },
  restructure: { favorabilityDelta: -8, infamyDelta: 5 },
};

export function computeExecutivePoliticalImpact(
  choice: SovereignResolutionChoice
): ExecutivePoliticalImpact {
  return IMPACT_BY_PATH[choice];
}

/**
 * Apply the calibrated impact to the proposing character. No-op when
 * `characterId` is null (NPC executive — political impact for NPPs is
 * separate and runs through their own favorability system).
 */
export async function applyExecutivePoliticalImpact(
  db: Db,
  characterId: ObjectId | null | undefined,
  choice: SovereignResolutionChoice
): Promise<{ applied: boolean }> {
  if (!characterId) return { applied: false };
  const impact = computeExecutivePoliticalImpact(choice);
  await db.collection<Character>("characters").updateOne(
    { _id: characterId },
    {
      $inc: {
        favorability: impact.favorabilityDelta,
        infamy: impact.infamyDelta,
      },
    }
  );
  return { applied: true };
}
