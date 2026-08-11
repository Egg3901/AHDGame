import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { isR2Enabled, deleteFileByUrl } from "@/lib/r2";
import { parseJsonBody } from "@/lib/api/validate";
import { getPlayerBannerAdsCollection } from "@/lib/db/collections/playerBannerAds";
import { handleRouteError } from "@/lib/api/errors";

type RouteContext = { params: Promise<{ id: string }> };

const toggleAdSchema = z
  .object({
    isActive: z.boolean().optional(),
    moderationStatus: z.enum(["pending", "approved", "rejected"]).optional(),
  })
  .refine((data) => data.isActive !== undefined || data.moderationStatus !== undefined, {
    message: "Provide isActive and/or moderationStatus.",
  });

// PATCH /api/admin/player-ads/[id] — Toggles active state and/or sets moderation status.
// Auth: requireAdmin
// Errors: 400, 401, 404
export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid ad ID." }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, toggleAdSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.isActive !== undefined) {
      updates.isActive = parsed.data.isActive;
    }
    if (parsed.data.moderationStatus !== undefined) {
      updates.moderationStatus = parsed.data.moderationStatus;
      updates.moderatedAt = new Date();
    }

    const ads = await getPlayerBannerAdsCollection();
    const result = await ads.updateOne({ _id: new ObjectId(id) }, { $set: updates });

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Ad not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

// DELETE /api/admin/player-ads/[id] — Permanently removes a player banner ad and blob asset.
// Auth: requireAdmin
// Errors: 400, 401, 404
export async function DELETE(_req: Request, { params }: RouteContext) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid ad ID." }, { status: 400 });
    }

    const ads = await getPlayerBannerAdsCollection();
    const ad = await ads.findOne({ _id: new ObjectId(id) }, { projection: { imageUrl: 1 } });
    if (!ad) {
      return NextResponse.json({ error: "Ad not found." }, { status: 404 });
    }

    await ads.deleteOne({ _id: new ObjectId(id) });

    // Best-effort R2 cleanup keeps storage tidy without blocking deletion success.
    if (isR2Enabled()) {
      deleteFileByUrl(ad.imageUrl).catch(() => {});
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
