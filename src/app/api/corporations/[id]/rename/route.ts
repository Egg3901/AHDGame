import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { renameCorporationSchema } from "@/lib/api/schemas/corporations";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { getGameState } from "@/lib/gameState";
import {
  CORPORATION_RENAME_COST,
  CORPORATION_RENAME_MS_PENALTY,
  CORPORATION_RENAME_COOLDOWN_TURNS,
} from "@/lib/constants/corporations";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  getCorpFxRate,
} from "@/lib/currency/corporationCapital";
import { logWireEvent } from "@/lib/wireEvent";
import { formatFundsCompact } from "@/lib/utils/formatters";
import type { Corporation } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/rename
 * Rename a corporation. CEO only.
 * Cost: $500,000 (₳) from liquid capital + 25% of current marketing strength.
 * 48-turn cooldown between renames. Name must be unique (case-insensitive).
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, renameCorporationSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { name: newName } = parsed.data;
    const db = await getDb();

    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    // Same name — no-op
    if (corporation.name === newName) {
      return NextResponse.json(
        { error: "New name is the same as the current name" },
        { status: 400 }
      );
    }

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;

    // Enforce cooldown
    const lastRenameTurn = corporation.lastRenameTurn ?? 0;
    const cooldownEnd = lastRenameTurn + CORPORATION_RENAME_COOLDOWN_TURNS;
    if (currentTurn < cooldownEnd) {
      const remaining = cooldownEnd - currentTurn;
      return NextResponse.json(
        { error: `Rename on cooldown. ${remaining} turn${remaining === 1 ? "" : "s"} remaining.` },
        { status: 400 }
      );
    }

    // Check name uniqueness (case-insensitive), same pattern as corporation founding
    const escapedName = newName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nameTaken = await db.collection<Corporation>("corporations").findOne({
      _id: { $ne: corporation._id },
      name: { $regex: new RegExp(`^${escapedName}$`, "i") },
    });
    if (nameTaken) {
      return NextResponse.json(
        { error: "A corporation with that name already exists" },
        { status: 400 }
      );
    }

    // Check liquid capital covers the cost (₳ → corp home currency)
    const corpFxRate = await getCorpFxRate(db, corporation);
    const corpCapitalAnchor = corpLiquidCapitalToAnchor(
      corporation.liquidCapital,
      corporation,
      corpFxRate
    );
    if (corpCapitalAnchor < CORPORATION_RENAME_COST) {
      return NextResponse.json(
        {
          error: `Insufficient liquid capital. Need ${CORPORATION_RENAME_COST.toLocaleString()} (₳), have ${Math.round(corpCapitalAnchor).toLocaleString()} (₳).`,
        },
        { status: 400 }
      );
    }

    const costInCorpCurrency = anchorToCorpLiquidCapital(
      CORPORATION_RENAME_COST,
      corporation,
      corpFxRate
    );

    // Calculate MS penalty: 25% of current marketing strength
    const msPenalty = Math.round(corporation.marketingStrength * CORPORATION_RENAME_MS_PENALTY);

    const oldName = corporation.name;

    await db.collection<Corporation>("corporations").updateOne(
      { _id: corporation._id },
      {
        $set: {
          name: newName,
          lastRenameTurn: currentTurn,
          updatedAt: new Date(),
        },
        $inc: {
          liquidCapital: -costInCorpCurrency,
          marketingStrength: -msPenalty,
        },
      }
    );

    logWireEvent(
      "corporation_renamed",
      wireHeadlineCorpRenamed(oldName, newName, CORPORATION_RENAME_COST),
      { href: `/corporation/${corporation.sequentialId ?? corporation._id}` }
    );

    return NextResponse.json({
      success: true,
      oldName,
      newName,
      cost: CORPORATION_RENAME_COST,
      msPenalty,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// ── Wire headline helper ────────────────────────────────────────────────────

const CORP_RENAMED_TEMPLATES = [
  (oldName: string, newName: string, costLabel: string) =>
    `REBRAND: ${oldName} renames to ${newName} — ${costLabel} in rebranding costs`,
  (oldName: string, newName: string, _costLabel: string) =>
    `NEW IDENTITY: ${oldName} is now ${newName}`,
  (oldName: string, newName: string, costLabel: string) =>
    `CORPORATE REBRAND: ${oldName} becomes ${newName}, spending ${costLabel}`,
  (oldName: string, newName: string, _costLabel: string) =>
    `NAME CHANGE: ${oldName} rebrands as ${newName}`,
];

function wireHeadlineCorpRenamed(oldName: string, newName: string, cost: number): string {
  const costLabel = formatFundsCompact(Math.round(cost));
  const tpl = CORP_RENAMED_TEMPLATES[Math.floor(Math.random() * CORP_RENAMED_TEMPLATES.length)];
  return tpl(oldName, newName, costLabel);
}
