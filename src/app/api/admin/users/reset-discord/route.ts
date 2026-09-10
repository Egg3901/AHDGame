import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { withNoStore } from "@/lib/api/withNoStore";
import { createAdminLog } from "@/lib/adminLog";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { authRevocationSnapshotFilter } from "@/lib/auth/sessionIssue";
import { authMigrationFenceAbsentFilter, isAuthMigrationFenced } from "@/lib/auth/sourceFence";
import { invalidateCachedUser } from "@/lib/auth/userDocCache";
import { z } from "zod";
import type { User } from "@/lib/db/types";

const resetDiscordSchema = z.object({
  userId: schemas.objectId,
});

const fenceConflictMessage =
  "This account changed during this request. Please reload and try again.";

// POST /api/admin/users/reset-discord: Clear the Discord link from a single
// target account. Auth: requireAdmin. Errors: 400, 403, 404, 409, 503
export const POST = withNoStore(async (request: Request) => {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    const { admin } = auth;

    const parsed = await parseJsonBody(request, resetDiscordSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { userId } = parsed.data;
    const objectId = new ObjectId(userId);

    const db = await getDb();
    const usersCollection = db.collection<User>("users");

    // Fresh target read. Ban state is intentionally not part of any filter:
    // a banned target stays repairable, as with the admin password reset.
    const targetUser = await usersCollection.findOne({ _id: objectId });
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    // Fenced accounts fail closed. Any present fence value, including null or
    // malformed shapes, denies (see isAuthMigrationFenced).
    if (isAuthMigrationFenced(targetUser)) {
      return NextResponse.json({ error: fenceConflictMessage }, { status: 409 });
    }

    const discordId = targetUser.discordId;
    const discordUsername = targetUser.discordUsername;
    const linked = typeof discordId === "string" && discordId.length > 0;

    if (!linked) {
      // Idempotent: no Discord link, so no credential write at all.
      try {
        await createAdminLog({
          category: "account",
          action: "discord_reset",
          username: targetUser.username,
          adminUsername: admin.username,
          details: "No Discord link was present; no account changes were made.",
        });
      } catch {
        // Best effort; the no-op success stands without audit.
      }
      return NextResponse.json({
        success: true,
        message: "No Discord link is present. No account changes were needed.",
        affectedAccounts: 0,
      });
    }

    // Never strand an account: unlinking Discord requires another usable login
    // method (non-empty password or a linked Google account) to remain.
    const hasPassword = typeof targetUser.password === "string" && targetUser.password.length > 0;
    const hasGoogle = typeof targetUser.googleId === "string" && targetUser.googleId.length > 0;
    if (!hasPassword && !hasGoogle) {
      return NextResponse.json(
        {
          error:
            "This account would have no remaining login method. Set another login method first.",
        },
        { status: 409 }
      );
    }

    // Discord ids carry a nonempty unique index. A second account holding this
    // id anyway is an invariant violation: fail closed, never merge or bulk-fix.
    const duplicate = await usersCollection.findOne(
      { discordId, _id: { $ne: objectId } },
      { projection: { _id: 1 } }
    );
    if (duplicate) {
      return NextResponse.json({ error: fenceConflictMessage }, { status: 409 });
    }

    const now = new Date();

    // Remove this process's cached account before starting the write.
    invalidateCachedUser(objectId.toHexString());

    // Single-target CAS: the write lands only when the exact
    // password/googleId/discordId/authRevokedAt snapshot still holds and no
    // fence arrived concurrently. A lost race surfaces as matchedCount 0.
    let updated;
    try {
      updated = await usersCollection.updateOne(
        {
          _id: objectId,
          password: targetUser.password ?? null,
          ...(targetUser.googleId === undefined
            ? { googleId: { $exists: false } }
            : { googleId: targetUser.googleId }),
          discordId,
          ...authRevocationSnapshotFilter(targetUser.authRevokedAt),
          ...authMigrationFenceAbsentFilter(),
        },
        {
          $unset: {
            discordId: "",
            discordUsername: "",
            discordAvatar: "",
            discordLinkedAt: "",
          },
          $set: { updatedAt: now },
          $max: { authRevokedAt: now },
        }
      );
    } catch {
      return NextResponse.json(
        { error: "Discord reset is temporarily unavailable. Please try again." },
        { status: 503 }
      );
    } finally {
      // A lost acknowledgment may still mean the write committed. Remove any
      // cached account again on every settled write, including failure.
      invalidateCachedUser(objectId.toHexString());
    }

    if (updated.acknowledged !== true) {
      return NextResponse.json(
        { error: "Discord reset is temporarily unavailable. Please try again." },
        { status: 503 }
      );
    }

    if (updated.matchedCount !== 1) {
      return NextResponse.json({ error: fenceConflictMessage }, { status: 409 });
    }

    // Post-commit lookups and audit are best effort: the unlink already
    // committed, so they must not convert success into a retryable failure.
    let characterName: string | undefined;
    try {
      const character = await db.collection("characters").findOne({ userId: objectId });
      characterName = character?.name;
    } catch {
      characterName = undefined;
    }
    try {
      await createAdminLog({
        category: "account",
        action: "discord_reset",
        username: targetUser.username,
        characterName,
        adminUsername: admin.username,
        details: `Reset Discord link for ${discordUsername || discordId}.`,
      });
    } catch {
      // Best effort; the unlink already committed.
    }

    return NextResponse.json({
      success: true,
      message: `Discord link reset for ${targetUser.username}. User can now re-link their Discord.`,
      affectedAccounts: 1,
    });
  } catch (error) {
    return handleRouteError(error);
  }
});
