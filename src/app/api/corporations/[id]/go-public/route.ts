import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { goPublicSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { subsidiaryIssuanceBlockReason } from "@/lib/corporations/subsidiaries/issuanceGuard";
import { getGameState } from "@/lib/gameState";
import { goPublic } from "@/lib/corporations/commands/capitalOperations/goPublic";
import { logWireEvent, wireHeadlineCorpIpo } from "@/lib/wireEvent";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/go-public
 * Convert a private corporation to public via late IPO.
 * CEO only. Floats `floatPct` % of post-IPO total shares to the public market
 * at the current sharePrice; proceeds flow into corp treasury. 96-turn cooldown
 * since founding (or last privatization).
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 5, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, goPublicSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const subBlock = await subsidiaryIssuanceBlockReason(corporation);
    if (subBlock) return NextResponse.json({ error: subBlock }, { status: 403 });

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;

    const result = await goPublic({
      db,
      corporation,
      floatPct: parsed.data.floatPct,
      currentTurn,
      superShareMultiplier: parsed.data.superShareMultiplier,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    logWireEvent("corporation_ipo", wireHeadlineCorpIpo(corporation.name, parsed.data.floatPct), {
      href: `/corporation/${corporation.sequentialId ?? corporation._id}`,
    });

    return NextResponse.json({
      newShares: result.newShares,
      requestedShares: result.requestedShares,
      pendingShares: result.pendingShares,
      proceeds: result.proceeds,
      totalSharesAfter: result.totalSharesAfter,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
