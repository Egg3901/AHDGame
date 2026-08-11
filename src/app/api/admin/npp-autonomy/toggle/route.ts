import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { GameState } from "@/lib/db/types";

const bodySchema = z.object({ enabled: z.boolean() });

/**
 * GET /api/admin/npp-autonomy/toggle
 * Read the current NPP-autonomy flag state. Auth: requireAdmin.
 */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const doc = await db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { nppAutonomyEnabled: 1 } });

    return NextResponse.json({ nppAutonomyEnabled: doc?.nppAutonomyEnabled === true });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * POST /api/admin/npp-autonomy/toggle
 * Flip the smarter-NPP autonomy system on/off. When on, NPP-autonomy behaviors
 * activate ONLY in disabled/econ-only countries (gated by isNppAutonomyActive).
 * Auth: requireAdmin
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const now = new Date().toISOString();
    // Keep the new 4-state level in sync so it (which wins on read) never goes
    // stale behind this legacy boolean toggle: enable → "v0", disable → "off".
    const set: Partial<GameState> = {
      nppAutonomyEnabled: parsed.data.enabled,
      nppAutonomyLevel: parsed.data.enabled ? "v0" : "off",
      updatedAt: new Date(),
    };
    if (parsed.data.enabled) {
      set.nppAutonomyEnabledBy = auth.admin.username;
      set.nppAutonomyEnabledAt = now;
    }

    await db
      .collection<GameState>("gameState")
      .updateOne(
        { _id: "current" },
        parsed.data.enabled
          ? { $set: set }
          : { $set: set, $unset: { nppAutonomyEnabledBy: "", nppAutonomyEnabledAt: "" } }
      );

    return NextResponse.json({ success: true, nppAutonomyEnabled: parsed.data.enabled });
  } catch (error) {
    return handleRouteError(error);
  }
}
