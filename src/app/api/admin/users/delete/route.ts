import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { createAdminLog } from "@/lib/adminLog";
import { parseJsonBody } from "@/lib/api/validate";
import { adminDeleteUserSchema } from "@/lib/api/schemas/admin";
import { cascadeCharacterDeletion } from "@/lib/account/cascadeCharacterDeletion";
import { stampSubjectDeleted } from "@/lib/financialTxLog/stampDeleted";
import { logCharacterDeleted } from "@/lib/db/collections/activityLog";

// POST /api/admin/users/delete — Permanently delete a user account and their character.
// Auth: requireAdmin
// Errors: 400, 401, 403, 404
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { admin } = auth;

    const parsed = await parseJsonBody(request, adminDeleteUserSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { userId } = parsed.data;
    const objectId = new ObjectId(userId);

    // Prevent deleting yourself
    if (admin.userId === userId) {
      return NextResponse.json({ error: "You cannot delete yourself" }, { status: 400 });
    }

    const db = await getDb();
    const usersCollection = db.collection("users");
    const charactersCollection = db.collection("characters");
    const actionLogsCollection = db.collection("actionLogs");
    const officialsCollection = db.collection("electedOfficials");

    // Check if user exists
    const user = await usersCollection.findOne({ _id: objectId });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Prevent deleting other admins
    if (user.isAdmin) {
      return NextResponse.json({ error: "Cannot delete admin users" }, { status: 400 });
    }

    // Find the user's character
    const character = await charactersCollection.findOne({ userId: objectId });

    // Log admin deletion with tracking data (before actually deleting)
    // WHY: Deleted accounts lose all IP/fingerprint data — this preserves an audit trail for fraud investigation
    await createAdminLog({
      category: "account",
      action: "account_deleted_admin",
      username: user.username,
      characterName: character?.name,
      adminUsername: admin.username,
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
            characterDeletedAt: new Date(),
            characterName: character.name,
            username: user.username,
            countryId: (character as { countryId?: string }).countryId,
          },
        }
      );

      // Phase 4: stamp tx history before deleting the character doc so admin
      // forensic queries still resolve subjectName/sequentialId after the
      // entity is gone. Admin force-delete is the path most likely to hit
      // tx for accounts that need post-deletion investigation.
      await stampSubjectDeleted(db, character._id, {
        sequentialId: (character as { sequentialId?: number }).sequentialId,
        deletedAt: new Date(),
      });

      // Snapshot the deletion into activityLog before the character doc is gone,
      // so the moderator drilldown retains an investigative marker + identity.
      await logCharacterDeleted(db, {
        reason: "admin_delete",
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
        reason: "admin_delete",
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

    // Delete the user
    await usersCollection.deleteOne({ _id: objectId });

    return NextResponse.json({
      success: true,
      message: `User ${user.username} and their character have been deleted`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
