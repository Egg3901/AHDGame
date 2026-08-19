import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { createAdminLog } from "@/lib/adminLog";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import type { User } from "@/lib/db/types";

const resetDiscordSchema = z.object({
  userId: z.string().length(24),
});

// POST /api/admin/users/reset-discord — Clear Discord link from a user's account across all linked accounts.
// Auth: requireAdmin
// Errors: 400, 403, 404
export async function POST(request: Request) {
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

    // Find the target user
    const targetUser = await usersCollection.findOne({ _id: objectId });
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const discordId = targetUser.discordId;
    const discordUsername = targetUser.discordUsername;

    // Find all accounts with this Discord ID (including the target user)
    let affectedCount = 0;
    if (discordId) {
      const result = await usersCollection.updateMany(
        { discordId },
        {
          $unset: {
            discordId: "",
            discordUsername: "",
            discordAvatar: "",
            discordLinkedAt: "",
          },
          $set: { updatedAt: new Date() },
        }
      );
      affectedCount = result.modifiedCount;
    } else {
      // No Discord linked - just clear any lingering Discord fields on this user
      await usersCollection.updateOne(
        { _id: objectId },
        {
          $unset: {
            discordId: "",
            discordUsername: "",
            discordAvatar: "",
            discordLinkedAt: "",
          },
          $set: { updatedAt: new Date() },
        }
      );
    }

    // Get character name for logging
    const character = await db.collection("characters").findOne({ userId: objectId });

    // Log the action
    await createAdminLog({
      category: "account",
      action: "discord_reset",
      username: targetUser.username,
      characterName: character?.name,
      adminUsername: admin.username,
      details: discordId
        ? `Reset Discord link for ${discordUsername || discordId}. Affected ${affectedCount} account(s).`
        : "Cleared Discord fields (no Discord was linked).",
    });

    return NextResponse.json({
      success: true,
      message: discordId
        ? `Discord link reset for ${affectedCount} account(s). User can now re-link their Discord.`
        : "Discord fields cleared. User can now link their Discord.",
      affectedAccounts: affectedCount,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
