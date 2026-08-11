import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { createAdminLog } from "@/lib/adminLog";
import type { GameConfig } from "@/lib/db/types";

const patchSchema = z.object({
  enabled: z.boolean(),
});

// GET /api/admin/party/first-joiner-chair — Current auto-chair-on-join setting (vacant national chair)
// Auth: requireAdmin
// Errors: 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { firstJoinerBecomesPartyChair: 1 } });

    // Undefined matches legacy DBs — same behavior as before this toggle existed.
    const enabled = config?.firstJoinerBecomesPartyChair !== false;

    return NextResponse.json({ enabled });
  } catch (error) {
    return handleRouteError(error);
  }
}

// PATCH /api/admin/party/first-joiner-chair — Enable or disable auto-promote to party chair on join
// Auth: requireAdmin
// Errors: 400, 403
export async function PATCH(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { enabled } = parsed.data;

    const db = await getDb();
    await db
      .collection<GameConfig>("gameConfig")
      .updateOne(
        { _id: "default" },
        { $set: { firstJoinerBecomesPartyChair: enabled } },
        { upsert: true }
      );

    await createAdminLog({
      category: "system",
      action: enabled ? "first_joiner_party_chair_enabled" : "first_joiner_party_chair_disabled",
      username: auth.admin.username,
      adminUsername: auth.admin.username,
      details: enabled
        ? "Joining a default party with no national chair and no active chair election will assign the joiner as chair."
        : "Joining a party with no national chair will not assign a chair automatically.",
    });

    return NextResponse.json({ success: true, enabled });
  } catch (error) {
    return handleRouteError(error);
  }
}
