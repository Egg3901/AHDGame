import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { GameState } from "@/lib/db/types/gameState";
import type { TradeEmbargo } from "@/lib/db/types/tradeEmbargo";
import type { TradeFlowSnapshot } from "@/lib/db/types/tradeFlowSnapshot";
import { getDb } from "@/lib/mongodb";
import {
  summarizeForeignPolicyLedger,
  type ForeignPolicyLedgerDecision,
} from "@/lib/nppAutonomy/foreignPolicyLedger";
import {
  foreignPolicyModeFrom,
  foreignPolicyStageFrom,
} from "@/lib/nppAutonomy/foreignPolicyRollout";

const LEDGER_WINDOW_TURNS = 120;
const LEDGER_DOCUMENT_LIMIT = 5_000;

function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 10_000) / 100;
}

/** GET /api/admin/npp/foreign-policy returns a bounded operational ledger. */
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const currentTurn = gameState?.currentTurn ?? 0;
    const fromTurn = Math.max(0, currentTurn - LEDGER_WINDOW_TURNS + 1);

    const [decisions, embargoes, tradeSnapshots, activeConflictCount] = await Promise.all([
      db
        .collection<ForeignPolicyLedgerDecision>("nppForeignPolicyDecisions")
        .find({ turn: { $gte: fromTurn } })
        .sort({ turn: -1, countryId: 1 })
        .limit(LEDGER_DOCUMENT_LIMIT)
        .toArray(),
      db.collection<TradeEmbargo>("tradeEmbargoes").find({}).toArray(),
      db
        .collection<TradeFlowSnapshot>("tradeFlowSnapshots")
        .find({})
        .sort({ turn: -1 })
        .limit(2)
        .toArray(),
      db
        .collection<ConflictDoc>("conflicts")
        .countDocuments({ status: { $in: ["active", "escalating", "winding_down"] } }),
    ]);

    const activeEmbargoes = embargoes.filter(
      (embargo) => embargo.expiresTurn == null || embargo.expiresTurn >= currentTurn
    );
    const temporaryDurations = embargoes
      .filter((embargo) => embargo.expiresTurn != null)
      .map((embargo) => Math.max(0, embargo.expiresTurn! - embargo.createdTurn));
    const currentTrade = tradeSnapshots[0]?.world.grossVolume ?? 0;
    const previousTrade = tradeSnapshots[1]?.world.grossVolume ?? 0;

    return NextResponse.json({
      currentTurn,
      fromTurn,
      throughTurn: currentTurn,
      documentLimitReached: decisions.length >= LEDGER_DOCUMENT_LIMIT,
      rollout: {
        mode: foreignPolicyModeFrom(gameState?.nppForeignPolicyMode),
        stage: foreignPolicyStageFrom(gameState?.nppForeignPolicyStage),
      },
      summary: summarizeForeignPolicyLedger(decisions),
      embargoes: {
        active: activeEmbargoes.length,
        activePairs: new Set(
          activeEmbargoes.map((embargo) => `${embargo.sourceCountry}:${embargo.targetCountry}`)
        ).size,
        averageTemporaryDurationTurns:
          temporaryDurations.length > 0
            ? Math.round(
                (temporaryDurations.reduce((sum, duration) => sum + duration, 0) /
                  temporaryDurations.length) *
                  100
              ) / 100
            : 0,
      },
      trade: {
        currentTurn: tradeSnapshots[0]?.turn ?? null,
        grossVolume: currentTrade,
        previousGrossVolume: previousTrade,
        changePercent: percentChange(currentTrade, previousTrade),
      },
      activeConflictCount,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
