import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { createAdminLog } from "@/lib/adminLog";
import { parseJsonBody } from "@/lib/api/validate";
import { adminBanUserSchema } from "@/lib/api/schemas/admin";
import { withdrawAllCandidatesForUser } from "@/lib/elections/withdrawBannedCandidates";
import { cleanupPartyElectionsForBannedUser } from "@/lib/elections/cleanupPartyElectionsForBannedUser";
import { vacatePartyLeadershipForBannedUser } from "@/lib/elections/vacatePartyLeadershipForBannedUser";
import { stripPartyMembershipForBannedUser } from "@/lib/account/stripPartyMembershipForBannedUser";
import { loadUserCharacterAndCeoCorpIds } from "@/lib/account/loadUserCharacterAndCeoCorpIds";
import { syncSuspiciousFlagsForBanState } from "@/lib/account/syncSuspiciousFlagsForBanState";
import { invalidateCachedUser } from "@/lib/auth/userDocCache";

// POST /api/admin/users/ban — Ban or unban a user by userId.
// Auth: requireAdmin
// Errors: 400, 401, 403, 404
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { admin } = auth;

    const parsed = await parseJsonBody(request, adminBanUserSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { userId, ban, reason } = parsed.data;
    const db = await getDb();
    const objectId = new ObjectId(userId);

    // Prevent banning yourself
    if (admin.userId === userId) {
      return NextResponse.json({ error: "You cannot ban yourself" }, { status: 400 });
    }

    const usersCollection = db.collection("users");

    // Check if user exists
    const user = await usersCollection.findOne({ _id: objectId });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Prevent banning other admins
    if (user.isAdmin) {
      return NextResponse.json({ error: "Cannot ban admin users" }, { status: 400 });
    }

    // Get character name for logging
    const character = await db.collection("characters").findOne({ userId: objectId });

    // Update the ban status
    if (ban) {
      const { ceoCorpIds } = await loadUserCharacterAndCeoCorpIds(db, objectId);
      await usersCollection.updateOne(
        { _id: objectId },
        {
          $set: {
            isBanned: true,
            banReason: reason || "Violation of rules",
            bannedAt: new Date(),
            authRevokedAt: new Date(),
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
      // Withdraw their party-leadership/committee candidacies and purge their
      // votes so banned accounts can no longer influence those tallies.
      await cleanupPartyElectionsForBannedUser(db, objectId);
      // Vacate any seated chair / vice chair / treasurer / committee positions
      // they currently hold so leadership-gated authorization stops resolving
      // through a banned account.
      await vacatePartyLeadershipForBannedUser(db, objectId);
      await stripPartyMembershipForBannedUser(db, objectId);
    } else {
      await usersCollection.updateOne(
        { _id: objectId },
        {
          $set: {
            isBanned: false,
            updatedAt: new Date(),
          },
          $unset: {
            banReason: "",
            bannedAt: "",
            bannedShareReleaseProcessedAt: "",
            bannedShareReleaseCorporationIds: "",
          },
        }
      );
    }

    // Drop the cached user doc so ban / token-revocation takes effect on the
    // next request instead of waiting out the userDocCache TTL.
    invalidateCachedUser(userId);

    // Resolve suspicious flags on ban; restore ban-resolved flags on unban.
    await syncSuspiciousFlagsForBanState(db, objectId, ban);

    // Log the ban/unban action
    await createAdminLog({
      category: "account",
      action: ban ? "account_banned" : "account_unbanned",
      username: user.username,
      characterName: character?.name,
      adminUsername: admin.username,
      details: ban ? reason || "Violation of rules" : undefined,
    });

    return NextResponse.json({
      success: true,
      message: ban
        ? `User ${user.username} has been banned`
        : `User ${user.username} has been unbanned`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
