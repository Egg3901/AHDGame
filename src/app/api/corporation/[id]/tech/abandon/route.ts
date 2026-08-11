/**
 * POST /api/corporation/[id]/tech/abandon — CEO abandons a decade's committed
 * tech lane (to switch tracks). Gated by `sectorTechTreesEnabled`. CEO only.
 * Removes that decade's unlocked nodes and frees the lane; NO refund. Logic in
 * the shared command (lib/corporations/commands/techTree/abandonTechDecade).
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
import { abandonTechDecade } from "@/lib/corporations/commands/techTree/abandonTechDecade";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import type { GameState } from "@/lib/db/types";

const abandonSchema = z.object({
  decadeId: z.string().min(1).max(16),
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
    const parsed = await parseJsonBody(request, abandonSchema);
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

    const result = await abandonTechDecade(db, corporation, parsed.data.decadeId, currentYear);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      decadeId: result.decadeId,
      removedNodeIds: result.removedNodeIds,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
