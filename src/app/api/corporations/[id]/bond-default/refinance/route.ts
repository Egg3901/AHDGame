import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { parseJsonBody } from "@/lib/api/validate";
import { bondDefaultRefinanceSchema } from "@/lib/api/schemas/bondDefault";
import { handleRouteError } from "@/lib/api/errors";
import type { BondMaturityTurns } from "@/lib/db/types";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { getGameState } from "@/lib/gameState";
import { executeCorporationBondRefinance } from "@/lib/bonds/executeCorporationBondRefinance";
import { MAX_BOND_DEFAULT_REFINANCES } from "@/lib/constants/bonds";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/bond-default/refinance
 * Issue a new bond for the full amount of defaulted principal, migrate holders, mature old bonds.
 * Bypasses issuance cooldown; still enforces 2× equity and minimum issuance size.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, bondDefaultRefinanceSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { maturityTurns } = parsed.data;

    const db = await getDb();

    // Refinancing a defaulted bond (issues a replacement bond) is a corporation
    // action: blocked while an admin has paused corporation actions.
    const pausedGuard = await requireCorporationActionsEnabled(db);
    if (pausedGuard) return pausedGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (corporation.countryOwnerId) {
      return NextResponse.json(
        { error: "Not available for national corporations" },
        { status: 400 }
      );
    }

    if (corporation.imfBailoutActive) {
      return NextResponse.json(
        { error: "IMF restructuring is active — bond refinance is not available." },
        { status: 400 }
      );
    }

    // Cap lifetime refinances to prevent default → refi cash-extraction loops.
    // Cheap pre-check so the HTTP path returns the rich, player-facing cap
    // message before paying for the shared lib's bond/sector/FX lookups; the
    // lib re-enforces the same cap defensively.
    const refiCount = corporation.bondDefaultRefinanceCount ?? 0;
    if (refiCount >= MAX_BOND_DEFAULT_REFINANCES) {
      return NextResponse.json(
        {
          error: `Refinance limit reached. A corporation can refinance defaulted debt at most ${MAX_BOND_DEFAULT_REFINANCES} times. Dissolution is the only remaining option for the defaulted bonds.`,
        },
        { status: 400 }
      );
    }

    // Game state is required: refinance writes `issuedAtTurn`, `maturityTurn`,
    // and `defaultCure.curedAtTurn` from `currentTurn`, plus the
    // bond_issuance ledger row's `turn`. Hoisted up above the expensive
    // bond/sector/FX lookups so a missing game state aborts the route fast
    // instead of paying for a dozen DB round-trips.
    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;
    if (currentTurn <= 0) {
      return NextResponse.json(
        { error: "Game state unavailable; refinance cannot be processed." },
        { status: 503 }
      );
    }

    const now = new Date();
    const result = await executeCorporationBondRefinance(db, corporation, {
      now,
      currentTurn,
      maturityTurns: maturityTurns as BondMaturityTurns,
    });

    if (!result.ok) {
      const status =
        result.reason === "No defaulted bonds to refinance"
          ? 400
          : result.reason === "Refinance limit reached"
            ? 400
            : 400;
      const error =
        result.reason === "No defaulted bonds to refinance"
          ? "No defaulted bonds to refinance"
          : result.reason === "Refinance limit reached"
            ? `Refinance limit reached. A corporation can refinance defaulted debt at most ${MAX_BOND_DEFAULT_REFINANCES} times. Dissolution is the only remaining option for the defaulted bonds.`
            : "Cannot refinance within debt limits. The defaulted principal exceeds the 2× equity issuance cap (or falls below the minimum issuance size).";
      return NextResponse.json({ error }, { status });
    }

    return NextResponse.json({
      success: true,
      bondId: result.bondId,
      faceValue: result.faceValueAnchor,
      couponRate: result.couponRate,
      maturityTurns,
      maturityTurn: result.maturityTurn,
      retiredBondIds: result.retiredBondIds,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
