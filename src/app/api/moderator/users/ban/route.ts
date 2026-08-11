import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { createModAuditLog } from "@/lib/modAuditLog";
import { parseJsonBody } from "@/lib/api/validate";
import { adminBanUserSchema } from "@/lib/api/schemas/admin";
import { withdrawAllCandidatesForUser } from "@/lib/elections/withdrawBannedCandidates";
import { cleanupPartyElectionsForBannedUser } from "@/lib/elections/cleanupPartyElectionsForBannedUser";
import { vacatePartyLeadershipForBannedUser } from "@/lib/elections/vacatePartyLeadershipForBannedUser";
import { stripPartyMembershipForBannedUser } from "@/lib/account/stripPartyMembershipForBannedUser";
import type { User } from "@/lib/db/types";
import { loadUserCharacterAndCeoCorpIds } from "@/lib/account/loadUserCharacterAndCeoCorpIds";
import { syncSuspiciousFlagsForBanState } from "@/lib/account/syncSuspiciousFlagsForBanState";
import { invalidateCachedUser } from "@/lib/auth/userDocCache";

// POST /api/moderator/users/ban — Ban or unban a user.
// Auth: requireModerator
// Errors: 400, 403, 404
export async function POST(request: Request) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;
    const { user: moderator } = auth;

    const parsed = await parseJsonBody(request, adminBanUserSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { userId, ban, reason } = parsed.data;
    const db = await getDb();
    const objectId = new ObjectId(userId);

    if (moderator.userId === userId) {
      return NextResponse.json({ error: "You cannot ban yourself" }, { status: 400 });
    }

    const targetUser = await db.collection<User>("users").findOne({ _id: objectId });
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Moderators cannot affect admin accounts
    if (targetUser.role === "admin") {
      return NextResponse.json(
        { error: "Cannot perform actions on admin accounts" },
        { status: 403 }
      );
    }

    if (ban) {
      const { ceoCorpIds } = await loadUserCharacterAndCeoCorpIds(db, objectId);
      await db.collection<User>("users").updateOne(
        { _id: objectId },
        {
          $set: {
            isBanned: true,
            banReason: reason || "Violation of rules",
            bannedAt: new Date(),
            bannedShareReleaseCorporationIds: ceoCorpIds,
            updatedAt: new Date(),
          },
          $unset: {
            bannedShareReleaseProcessedAt: "",
          },
        }
      );

      // Withdraw banned user from all active elections
      await withdrawAllCandidatesForUser(db, objectId);
      await cleanupPartyElectionsForBannedUser(db, objectId);
      await vacatePartyLeadershipForBannedUser(db, objectId);
      await stripPartyMembershipForBannedUser(db, objectId);
    } else {
      await db.collection<User>("users").updateOne(
        { _id: objectId },
        {
          $set: { isBanned: false, updatedAt: new Date() },
          $unset: {
            banReason: "",
            bannedAt: "",
            bannedShareReleaseProcessedAt: "",
            bannedShareReleaseCorporationIds: "",
          },
        }
      );
    }

    // Drop the cached user doc so ban takes effect on the next request instead
    // of waiting out the userDocCache TTL.
    invalidateCachedUser(userId);

    // Resolve suspicious flags on ban; restore ban-resolved flags on unban.
    await syncSuspiciousFlagsForBanState(db, objectId, ban);

    await createModAuditLog({
      moderatorId: moderator.userId,
      moderatorName: moderator.username,
      action: ban ? "ban_user" : "unban_user",
      targetUserId: userId,
      targetUsername: targetUser.username,
      details: ban ? reason || "Violation of rules" : undefined,
    });

    return NextResponse.json({
      success: true,
      message: ban
        ? `User ${targetUser.username} has been banned`
        : `User ${targetUser.username} has been unbanned`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
