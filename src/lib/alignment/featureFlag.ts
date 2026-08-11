import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types";

/**
 * Master gate for IntOrg alignment. Fail-closed: only an explicit `true`
 * enables. Flipped from the admin Feature Gates panel
 * (`/api/admin/feature-gates`, key `intOrgAlignmentEnabled`).
 *
 * Pass `preloaded` when the caller already holds a gameState projection — the
 * world query does — so the flag costs no extra round trip.
 */
export async function isIntOrgAlignmentEnabled(preloaded?: {
  intOrgAlignmentEnabled?: boolean;
}): Promise<boolean> {
  if (preloaded !== undefined) {
    return preloaded.intOrgAlignmentEnabled === true;
  }
  const db = await getDb();
  const gs = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { intOrgAlignmentEnabled: 1 } });
  return gs?.intOrgAlignmentEnabled === true;
}
