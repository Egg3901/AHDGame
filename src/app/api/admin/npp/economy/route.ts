import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import type { NPP, GameConfig, GameState } from "@/lib/db/types";

/** GET — return NPP economy enabled status and aggregate stats */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    const [config, gameState, statsResult] = await Promise.all([
      db
        .collection<GameConfig>("gameConfig")
        .findOne({ _id: "default" }, { projection: { nppEconomyEnabled: 1 } }),
      db
        .collection<GameState>("gameState")
        .findOne({ _id: "current" }, { projection: { currentTurn: 1 } }),
      db
        .collection<NPP>("npps")
        .aggregate([
          { $match: { retiredAt: null } },
          {
            $group: {
              _id: null,
              totalNpps: { $sum: 1 },
              nppsWithFunds: { $sum: { $cond: [{ $gt: ["$funds", 0] }, 1, 0] } },
              totalFunds: { $sum: { $ifNull: ["$funds", 0] } },
              totalActionPoints: { $sum: { $ifNull: ["$actionPoints", 0] } },
              avgDonorBaseLevel: { $avg: { $ifNull: ["$donorBaseLevel", 0] } },
            },
          },
        ])
        .toArray(),
    ]);

    const enabled = config?.nppEconomyEnabled ?? false;
    const currentTurn = gameState?.currentTurn ?? 0;
    // Economy processes every turn when enabled; next processing turn is the next turn
    const nextProcessingTurn = currentTurn + 1;

    const statsDoc = statsResult[0] ?? null;
    const stats = {
      totalNpps: statsDoc?.totalNpps ?? 0,
      nppsWithFunds: statsDoc?.nppsWithFunds ?? 0,
      totalFunds: statsDoc?.totalFunds ?? 0,
      totalActionPoints: statsDoc?.totalActionPoints ?? 0,
      avgDonorBaseLevel: statsDoc?.avgDonorBaseLevel ?? 0,
    };

    return NextResponse.json({ enabled, currentTurn, nextProcessingTurn, stats });
  } catch (error) {
    return handleRouteError(error);
  }
}

const toggleSchema = z.object({
  enabled: z.boolean(),
});

/** POST — toggle NPP economy enabled/disabled */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, toggleSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { enabled } = parsed.data;

    const db = await getDb();
    await db
      .collection<GameConfig>("gameConfig")
      .updateOne({ _id: "default" }, { $set: { nppEconomyEnabled: enabled } }, { upsert: true });

    const message = enabled
      ? "NPP economy system enabled — fund generation and action processing will run each turn."
      : "NPP economy system disabled — fund generation and action processing are paused.";

    return NextResponse.json({ success: true, enabled, message });
  } catch (error) {
    return handleRouteError(error);
  }
}
