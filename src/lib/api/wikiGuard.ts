import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getGameStateCollection } from "@/lib/db/collections";
import { getAuthUser } from "@/lib/auth";
import { errorResponse } from "@/lib/api/errors";

/**
 * Returns a 403 response if the wiki is disabled and the caller is not an admin
 * or moderator. Mods get access during wiki staging so they can review seeded
 * content before it flips public. Returns null if the request should proceed.
 */
export async function checkWikiDisabled(): Promise<NextResponse | null> {
  const db = await getDb();
  const col = await getGameStateCollection(db);
  const gameState = await col.findOne({ _id: "current" });

  if (!gameState?.wikiDisabled) return null;

  const user = await getAuthUser().catch(() => null);
  if (user?.isAdmin || user?.isModerator) return null;

  return errorResponse(403, "Wiki is currently disabled");
}
