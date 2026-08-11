import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types";

/**
 * Master gate for the new-player onboarding checklist. When false or absent
 * the system is inert: the profile shows the legacy NewPlayerBanner, page
 * visits are not tracked, no welcome mail is sent at character creation, and
 * the completion reward cannot be claimed. Fail-closed: only an explicit
 * `true` on the gameState singleton enables it. Flipped from the admin
 * Feature Gates panel (`/api/admin/feature-gates`, key
 * `onboardingChecklistEnabled`); fresh worlds seed it on
 * (seeds/reference/featureFlagDefaults.ts).
 */
export async function isOnboardingChecklistEnabled(preloaded?: {
  onboardingChecklistEnabled?: boolean;
}): Promise<boolean> {
  if (preloaded !== undefined) {
    return preloaded.onboardingChecklistEnabled === true;
  }
  const db = await getDb();
  const gs = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { onboardingChecklistEnabled: 1 } });
  return gs?.onboardingChecklistEnabled === true;
}
