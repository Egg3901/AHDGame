import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { clearAuthCookie } from "@/lib/auth";
import { createAdminLog } from "@/lib/adminLog";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { cascadeCharacterDeletion } from "@/lib/account/cascadeCharacterDeletion";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { stampSubjectDeleted } from "@/lib/financialTxLog/stampDeleted";
import { cleanupCaucusParticipationForCharacters } from "@/lib/caucus/cleanupCaucusParticipationForCharacters";
import { logCharacterDeleted } from "@/lib/db/collections/activityLog";

// DELETE /api/auth/delete-account — Permanently deletes the authenticated user's account, character, and clears offices held.
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 429
export async function DELETE() {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const userId = auth.user.userId;
    const isAdmin = auth.user.isAdmin;

    const rateLimit = checkRateLimit(userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    // Prevent admins from self-deleting via this route
    if (isAdmin) {
      return NextResponse.json(
        { error: "Admin accounts cannot be self-deleted. Please contact another admin." },
        { status: 400 }
      );
    }

    const objectId = new ObjectId(userId);
    const db = await getDb();
    const usersCollection = db.collection("users");
    const charactersCollection = db.collection("characters");
    const actionLogsCollection = db.collection("actionLogs");
    const officialsCollection = db.collection("electedOfficials");

    // Verify user exists
    const user = await usersCollection.findOne({ _id: objectId });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Find the user's character
    const character = await charactersCollection.findOne({ userId: objectId });

    // Log account self-deletion with tracking data (before actually deleting)
    // WHY: Self-deleted alt accounts lose all IP/fingerprint data — this preserves an audit trail for fraud investigation
    await createAdminLog({
      category: "account",
      action: "account_deleted_self",
      username: user.username,
      characterName: character?.name,
      details: [
        user.registrationIp && `regIp: ${user.registrationIp}`,
        user.lastKnownIp && `lastIp: ${user.lastKnownIp}`,
        user.trackingId && `trackingId: ${user.trackingId}`,
        user.deviceKey && `deviceKey: ${user.deviceKey}`,
        user.fingerprintHistory?.length && `fingerprints: ${user.fingerprintHistory.join(", ")}`,
      ]
        .filter(Boolean)
        .join(" | "),
    });

    // If character exists, clear any elected offices they hold
    if (character) {
      const now = new Date();

      await officialsCollection.updateMany(
        { characterId: character._id },
        {
          $set: {
            characterId: null,
            characterName: null,
            party: null,
            updatedAt: new Date(),
          },
        }
      );

      await cleanupCaucusParticipationForCharacters(db, [character._id], {
        removeMembership: true,
        membershipStatus: "removed",
        now,
      });

      // Release any corporation shareholder positions to publicFloat and vacate
      // any CEO seat held by this character BEFORE deleting the character row,
      // so we don't leave orphaned holdings under a hard-deleted _id.
      await cascadeCharacterDeletion(db, character._id);

      // Retain action logs for forensics: stamp them deleted + denormalize
      // identity from the still-present docs so they stay readable afterward.
      await actionLogsCollection.updateMany(
        { characterId: character._id },
        {
          $set: {
            characterDeletedAt: now,
            characterName: character.name,
            username: user.username,
            countryId: (character as { countryId?: string }).countryId,
          },
        }
      );

      // Phase 4: stamp tx history before deleting the character doc so admin
      // forensic queries still resolve subjectName/sequentialId after the
      // entity is gone. The user-initiated account-self-delete path is the
      // most common way wealth-list players try to scrub their trail.
      await stampSubjectDeleted(db, character._id, {
        sequentialId: character.sequentialId,
        deletedAt: now,
      });

      // Snapshot the deletion into activityLog before the character doc is gone.
      await logCharacterDeleted(db, {
        reason: "self_delete",
        userId: objectId,
        username: user.username,
        characterId: character._id,
        characterName: character.name as string,
        countryId: (character as { countryId?: string }).countryId as never,
        details: {
          party: (character as { party?: string }).party ?? null,
          highestOffice: (character as { highestOffice?: string }).highestOffice ?? null,
          registrationIp: user.registrationIp ?? null,
          lastKnownIp: user.lastKnownIp ?? null,
          trackingId: user.trackingId ?? null,
          deviceKey: user.deviceKey ?? null,
          fingerprintCount: user.fingerprintHistory?.length ?? 0,
        },
      });

      // Delete the character
      await charactersCollection.deleteOne({ _id: character._id });
    }

    if (!character) {
      await logCharacterDeleted(db, {
        reason: "self_delete",
        userId: objectId,
        username: user.username,
        details: {
          registrationIp: user.registrationIp ?? null,
          lastKnownIp: user.lastKnownIp ?? null,
          trackingId: user.trackingId ?? null,
          deviceKey: user.deviceKey ?? null,
          fingerprintCount: user.fingerprintHistory?.length ?? 0,
        },
      });
    }

    // Delete retired characters and achievements for this user
    await db.collection("retiredCharacters").deleteMany({ userId: objectId });
    await db.collection("characterAchievements").deleteMany({ userId: objectId });

    // Delete the user
    await usersCollection.deleteOne({ _id: objectId });

    await clearAuthCookie("user_delete_account");

    return NextResponse.json({
      success: true,
      message: "Account deleted successfully",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
