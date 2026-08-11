import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireModerator } from "@/lib/api/requireModerator";
import { getPlayerBannerAdsCollection } from "@/lib/db/collections/playerBannerAds";
import { handleRouteError } from "@/lib/api/errors";
import { createModAuditLog } from "@/lib/modAuditLog";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import type { User } from "@/lib/db/types";
import { isR2Enabled, deleteFileByUrl } from "@/lib/r2";

type RouteContext = { params: Promise<{ id: string }> };

// DELETE /api/moderator/player-ads/[id] — permanently remove a player banner ad.
// Auth: requireModerator
// Errors: 400, 403, 404
export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;
    const { user: moderator } = auth;

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid ad ID." }, { status: 400 });
    }

    const ads = await getPlayerBannerAdsCollection();
    const ad = await ads.findOne(
      { _id: new ObjectId(id) },
      { projection: { imageUrl: 1, characterName: 1, userId: 1 } }
    );
    if (!ad) {
      return NextResponse.json({ error: "Ad not found." }, { status: 404 });
    }

    await ads.deleteOne({ _id: new ObjectId(id) });

    // Best-effort R2 cleanup
    if (isR2Enabled()) {
      deleteFileByUrl(ad.imageUrl).catch(() => {});
    }

    // Look up author username for audit log
    const db = await getDb();
    const authorUser = await db
      .collection<User>("users")
      .findOne({ _id: ad.userId }, { projection: { username: 1 } });

    await createModAuditLog({
      moderatorId: moderator.userId,
      moderatorName: moderator.username,
      action: "delete_player_ad",
      targetUserId: ad.userId.toString(),
      targetUsername: authorUser?.username ?? ad.characterName,
      details: `Banner ad by ${ad.characterName}`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

// PATCH /api/moderator/player-ads/[id] — toggle ad active/paused status.
// Auth: requireModerator
// Errors: 400, 403, 404
const patchSchema = z.object({
  isActive: z.boolean(),
});

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const auth = await requireModerator();
    if (!auth.ok) return auth.response;
    const { user: moderator } = auth;

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid ad ID." }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const ads = await getPlayerBannerAdsCollection();
    const ad = await ads.findOne(
      { _id: new ObjectId(id) },
      { projection: { characterName: 1, userId: 1 } }
    );
    if (!ad) {
      return NextResponse.json({ error: "Ad not found." }, { status: 404 });
    }

    await ads.updateOne({ _id: new ObjectId(id) }, { $set: { isActive: parsed.data.isActive } });

    // Look up author username for audit log
    const db = await getDb();
    const authorUser = await db
      .collection<User>("users")
      .findOne({ _id: ad.userId }, { projection: { username: 1 } });

    await createModAuditLog({
      moderatorId: moderator.userId,
      moderatorName: moderator.username,
      action: "toggle_player_ad",
      targetUserId: ad.userId.toString(),
      targetUsername: authorUser?.username ?? ad.characterName,
      details: `Set active=${parsed.data.isActive} for ad by ${ad.characterName}`,
    });

    return NextResponse.json({ success: true, isActive: parsed.data.isActive });
  } catch (error) {
    return handleRouteError(error);
  }
}
