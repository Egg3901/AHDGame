import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createModAuditLog } from "@/lib/modAuditLog";
import type { PatreonTier, User } from "@/lib/db/types";
import { applyPatreonStatus } from "@/lib/patreon/service";

const bodySchema = z.object({
  userId: z.string().refine((value) => ObjectId.isValid(value), "Invalid user ID"),
  tier: z.enum(["supporter", "supporter-plus", "supporter-plus-plus"]).nullable(),
  expiresAt: z.string().datetime().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
  patreonUserId: z.string().trim().min(1).max(100).optional(),
});

// POST /api/moderator/patreon/set-status — Set a user's Patreon tier.
// Auth: requireModerator
// Errors: 400, 403, 404
export async function POST(request: Request) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;
    const { user: moderator } = auth;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { userId, tier, expiresAt, reason, patreonUserId } = parsed.data;
    const db = await getDb();
    const objectId = new ObjectId(userId);

    const user = await db.collection<User>("users").findOne({ _id: objectId });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (user.role === "admin") {
      return NextResponse.json(
        { error: "Cannot perform actions on admin accounts" },
        { status: 403 }
      );
    }

    const expiresAtDate = tier === null ? new Date() : expiresAt ? new Date(expiresAt) : null;

    await applyPatreonStatus(db, {
      userId: objectId,
      tier: tier as PatreonTier,
      expiresAt: expiresAtDate,
      adsDisabledDefault: true,
      patreonUserId,
    });

    await createModAuditLog({
      moderatorId: moderator.userId,
      moderatorName: moderator.username,
      action: "set_patreon_status",
      targetUserId: userId,
      targetUsername: user.username,
      details:
        tier === null
          ? `Cleared Patreon status.${reason ? ` Reason: ${reason}` : ""}`
          : `Set Patreon tier to ${tier}${expiresAtDate ? ` until ${expiresAtDate.toISOString()}` : ""}.${reason ? ` Reason: ${reason}` : ""}`,
    });

    return NextResponse.json({
      success: true,
      userId,
      tier,
      expiresAt: expiresAtDate,
      patreonUserId: patreonUserId ?? user.patreonUserId ?? null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
