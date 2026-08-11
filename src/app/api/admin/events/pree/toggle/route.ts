import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import type { GameState } from "@/lib/db/types";

const bodySchema = z.object({
  enabled: z.boolean(),
});

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
    const set: Partial<GameState> = {
      playerRandomEventsEnabled: parsed.data.enabled,
      updatedAt: new Date(),
    };
    if (parsed.data.enabled) {
      set.playerRandomEventsEnabledBy = auth.admin.username;
      set.playerRandomEventsEnabledAt = now;
    }

    await db.collection<GameState>("gameState").updateOne(
      { _id: "current" },
      parsed.data.enabled
        ? { $set: set }
        : {
            $set: set,
            $unset: { playerRandomEventsEnabledBy: "", playerRandomEventsEnabledAt: "" },
          }
    );

    // Surface a config trap: enabling with zero approved templates means the
    // driver will never fire anything — tell the admin instead of going quiet.
    const approvedCount = parsed.data.enabled
      ? await db.collection("eventDefinitions").countDocuments({ status: "approved" })
      : null;

    return NextResponse.json({
      success: true,
      playerRandomEventsEnabled: parsed.data.enabled,
      approvedDefinitions: approvedCount,
      ...(parsed.data.enabled && approvedCount === 0
        ? {
            warning:
              "Random events are enabled, but no event templates are approved — nothing will fire until templates are seeded and approved.",
          }
        : {}),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
