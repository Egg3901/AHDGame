// POST /api/admin/corporations/reset-timers
// Resets all turn-based cooldown timers across all corporations.
// Auth: requireAdmin
// Errors: 401, 403

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { Corporation } from "@/lib/db/types";

export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const { modifiedCount } = await db.collection<Corporation>("corporations").updateMany(
      {},
      {
        $set: {
          typeSwitchCooldownUntilTurn: null,
          lastShareStructureTurn: null,
          updatedAt: new Date(),
        },
      }
    );

    return NextResponse.json({ success: true, modifiedCount });
  } catch (error) {
    return handleRouteError(error);
  }
}
