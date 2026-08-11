import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireHumanSessionWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { getDebateSessionsCollection } from "@/lib/db/collections/debateSessions";
import type { DebateParticipant, DebateSession } from "@/lib/db/types/debateSession";
import { DEBATE_STRATEGIES, DEBATE_STRATEGY_META } from "@/lib/debate/debateScoring";
import type { ObjectId } from "mongodb";

function mySide(session: DebateSession, characterId: ObjectId): "challenger" | "opponent" | null {
  if (
    session.challenger.kind === "character" &&
    session.challenger.characterId?.equals(characterId)
  )
    return "challenger";
  if (session.opponent.kind === "character" && session.opponent.characterId?.equals(characterId))
    return "opponent";
  return null;
}

function other(session: DebateSession, side: "challenger" | "opponent"): DebateParticipant {
  return side === "challenger" ? session.opponent : session.challenger;
}

const STRATEGY_OPTIONS = DEBATE_STRATEGIES.map((s) => ({
  id: s,
  label: DEBATE_STRATEGY_META[s].label,
  blurb: DEBATE_STRATEGY_META[s].blurb,
  linkedStat: DEBATE_STRATEGY_META[s].linkedStat,
}));

// GET /api/debates/active — the caller's active election debate (if any) plus
// their most recent resolved debate for outcome display.
// Auth: requireHumanSessionWithCharacter
export async function GET(request: Request) {
  try {
    const auth = await requireHumanSessionWithCharacter(request);
    if (!auth.ok) return auth.response;
    const character = auth.user.character;
    const db = await getDb();
    const sessions = getDebateSessionsCollection(db);

    const participantFilter = {
      $or: [
        { "challenger.kind": "character", "challenger.characterId": character._id },
        { "opponent.kind": "character", "opponent.characterId": character._id },
      ],
    };

    const [activeDoc, resolvedDoc] = await Promise.all([
      sessions.findOne({ status: "awaitingStrategies", ...participantFilter }),
      sessions.findOne({ status: "resolved", ...participantFilter }, { sort: { resolvedAt: -1 } }),
    ]);

    let active = null;
    if (activeDoc) {
      const side = mySide(activeDoc, character._id)!;
      const me = activeDoc[side];
      active = {
        id: activeDoc._id.toString(),
        opponentName: other(activeDoc, side).name,
        deadlineRealtimeMs: activeDoc.deadlineRealtimeMs,
        canSubmit: me.mode === "pvp" && (!me.strategies || me.strategies.length === 0),
        submittedStrategies: me.strategies ?? null,
        strategyOptions: STRATEGY_OPTIONS,
      };
    }

    let lastResolved = null;
    if (resolvedDoc?.outcome) {
      const side = mySide(resolvedDoc, character._id)!;
      const won =
        resolvedDoc.outcome.result === "draw"
          ? "draw"
          : resolvedDoc.outcome.result === side
            ? "won"
            : "lost";
      lastResolved = {
        id: resolvedDoc._id.toString(),
        opponentName: other(resolvedDoc, side).name,
        result: won,
        favorabilitySwing: resolvedDoc.outcome.favorabilitySwing,
        myStrategies: resolvedDoc[side].strategies ?? [],
        resolvedAt: resolvedDoc.resolvedAt ?? null,
      };
    }

    return NextResponse.json({ active, lastResolved });
  } catch (error) {
    return handleRouteError(error);
  }
}
