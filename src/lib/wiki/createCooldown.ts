import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { WikiPage } from "@/lib/db/types";

export const WIKI_CREATE_COOLDOWN_HOURS = 12;
export const WIKI_CREATE_COOLDOWN_MS = WIKI_CREATE_COOLDOWN_HOURS * 60 * 60 * 1000;

export interface CooldownResult {
  ok: boolean;
  /** Remaining cooldown in milliseconds; `0` when allowed. */
  remainingMs: number;
  /** Earliest ISO timestamp the user may create another page. */
  nextAllowedAt?: Date;
}

/**
 * Check whether a user may create a new wiki page right now.
 *
 * Edits to existing pages (PATCH/author edits, admin approvals) are not
 * rate-limited by this function — it only guards fresh page creation.
 * Admins and moderators bypass the cooldown so they can seed content.
 */
export async function checkWikiCreateCooldown(
  db: Db,
  userId: ObjectId,
  options: { bypass?: boolean } = {}
): Promise<CooldownResult> {
  if (options.bypass) return { ok: true, remainingMs: 0 };

  const latest = await db
    .collection<WikiPage>("wikiPages")
    .find({ submittedBy: userId })
    .sort({ createdAt: -1 })
    .limit(1)
    .project<{ createdAt: Date }>({ createdAt: 1 })
    .next();

  if (!latest?.createdAt) return { ok: true, remainingMs: 0 };

  const elapsed = Date.now() - new Date(latest.createdAt).getTime();
  if (elapsed >= WIKI_CREATE_COOLDOWN_MS) return { ok: true, remainingMs: 0 };

  const remainingMs = WIKI_CREATE_COOLDOWN_MS - elapsed;
  return {
    ok: false,
    remainingMs,
    nextAllowedAt: new Date(Date.now() + remainingMs),
  };
}

export function formatCooldownMessage(result: CooldownResult): string {
  if (result.ok) return "";
  const hours = Math.floor(result.remainingMs / (60 * 60 * 1000));
  const minutes = Math.ceil((result.remainingMs % (60 * 60 * 1000)) / (60 * 1000));
  if (hours >= 1) {
    return `You can create another wiki page in ${hours}h ${minutes}m. (12-hour cooldown between new pages — edits are unlimited.)`;
  }
  return `You can create another wiki page in ${minutes}m. (12-hour cooldown between new pages — edits are unlimited.)`;
}
