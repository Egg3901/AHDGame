import { NextResponse } from "next/server";
import type { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { User, Character } from "@/lib/db/types";
import { stripPartyMembershipForBannedUser } from "@/lib/account/stripPartyMembershipForBannedUser";

/**
 * GET /api/admin/heal/banned-party-membership
 * Count banned users who still have at least one character in a non-independent party.
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const bannedIds = await db
      .collection<User>("users")
      .find({ isBanned: true })
      .project<{ _id: ObjectId }>({ _id: 1 })
      .toArray();

    let affectedUsers = 0;
    let affectedCharacters = 0;

    for (const u of bannedIds) {
      const chars = await db
        .collection<Character>("characters")
        .find({
          userId: u._id,
          party: { $exists: true, $nin: ["", "independent"] },
        })
        .project({ _id: 1 })
        .toArray();
      if (chars.length > 0) {
        affectedUsers += 1;
        affectedCharacters += chars.length;
      }
    }

    return NextResponse.json({
      bannedUsersChecked: bannedIds.length,
      affectedUsers,
      affectedCharacters,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/heal/banned-party-membership
 * Strip party membership for every banned user (idempotent for already-independent characters).
 */
export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const bannedIds = await db
      .collection<User>("users")
      .find({ isBanned: true })
      .project<{ _id: ObjectId }>({ _id: 1 })
      .toArray();

    let charactersStripped = 0;

    for (const u of bannedIds) {
      const { charactersUpdated } = await stripPartyMembershipForBannedUser(db, u._id);
      charactersStripped += charactersUpdated;
    }

    return NextResponse.json({
      processedUsers: bannedIds.length,
      charactersStripped,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
