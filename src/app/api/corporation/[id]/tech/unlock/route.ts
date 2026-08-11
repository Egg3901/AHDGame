/**
 * POST /api/corporation/[id]/tech/unlock — CEO unlocks a sector tech-tree node.
 *
 * Gated by the `sectorTechTreesEnabled` feature flag. CEO only. Spends rdScore
 * (the R&D wallet) and records the per-decade pick. The unlock rules and the
 * atomic spend live in the shared command (lib/corporations/commands/techTree).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isSectorTechTreesEnabled } from "@/lib/corporations/techTree/featureFlag";
import { unlockTechNode } from "@/lib/corporations/commands/techTree/unlockTechNode";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import type { GameState } from "@/lib/db/types";

const unlockSchema = z.object({
  nodeId: z.string().min(1).max(64),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, unlockSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    if (!(await isSectorTechTreesEnabled(gameState ?? undefined))) {
      return NextResponse.json({ error: "Tech trees are not enabled" }, { status: 404 });
    }

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const currentTurn = gameState?.currentTurn ?? 1;
    const startingYear = gameState?.startingYear ?? STARTING_YEAR;
    const currentYear =
      gameState?.currentYear ?? startingYear + Math.floor((currentTurn - 1) / TURNS_PER_YEAR);

    const result = await unlockTechNode(
      db,
      corporation,
      parsed.data.nodeId,
      currentYear,
      currentTurn
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, reason: result.reason },
        {
          status: result.status,
        }
      );
    }

    return NextResponse.json({
      success: true,
      nodeId: result.nodeId,
      rdScoreRemaining: result.rdScoreRemaining,
      cashSpent: result.cashSpent,
      cashRemaining: result.cashRemaining,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
