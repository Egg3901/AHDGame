import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { Character } from "@/lib/db/types";

/**
 * One-time migration endpoint to fix account_created logs that are missing character names.
 * This finds all account_created logs without characterName and updates them with the
 * corresponding character's name if one exists.
 */
// POST /api/admin/logs/fix-character-names — Backfill missing character names on account_created admin logs.
// Auth: requireAdmin
// Errors: 403
export async function POST() {
  try {
    // Verify admin authentication
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Find all account_created logs missing character names
    const logsToFix = await db
      .collection("adminLogs")
      .find({
        action: "account_created",
        $or: [{ characterName: { $exists: false } }, { characterName: null }],
      })
      .toArray();

    if (logsToFix.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No logs need fixing",
        fixed: 0,
      });
    }

    let fixedCount = 0;
    const notFoundUsernames: string[] = [];

    for (const log of logsToFix) {
      // Find the user by username
      const user = await db.collection("users").findOne({ username: log.username });
      if (!user) {
        notFoundUsernames.push(log.username);
        continue;
      }

      // Find the character for this user
      const character = await db.collection<Character>("characters").findOne({ userId: user._id });
      if (!character) {
        // User exists but has no character - leave the log as is
        continue;
      }

      // Update the log with the character name
      await db
        .collection("adminLogs")
        .updateOne({ _id: log._id }, { $set: { characterName: character.name } });
      fixedCount++;
    }

    return NextResponse.json({
      success: true,
      message: `Fixed ${fixedCount} of ${logsToFix.length} logs`,
      fixed: fixedCount,
      total: logsToFix.length,
      notFoundUsernames: notFoundUsernames.length > 0 ? notFoundUsernames : undefined,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
