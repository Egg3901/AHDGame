/**
 * POST /api/admin/crises/vietnam-start
 *
 * Start the Vietnam escalation chain on demand instead of waiting for the turn
 * loop to open it. Spawns the opening rung, both superpowers' commitment
 * decisions, and the press coverage.
 *
 * Idempotent by construction: `openVietnamChain` opens the family exactly once
 * per world, so a second press reports that it is already running rather than
 * producing a second war. A chain that has been talked down to nothing stays
 * down.
 *
 * Auth: requireAdmin. Errors: 400, 403.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { getGameState } from "@/lib/gameState";
import { openVietnamChain } from "@/lib/crises/crisisChain";
import {
  rungForLevel,
  VIETNAM_FROM_YEAR,
  VIETNAM_UNTIL_YEAR,
} from "@/lib/crises/vietnamEscalation";

export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const gameState = await getGameState(db);
    const result = await openVietnamChain(db, gameState?.currentTurn ?? 1, gameState?.currentYear);

    if (!result.started) {
      const message =
        result.reason === "already_started"
          ? `The Vietnam chain is already running${
              rungForLevel(result.level) ? ` at rung ${result.level}` : " and has been stood down"
            }.`
          : `Vietnam runs from ${VIETNAM_FROM_YEAR} to ${VIETNAM_UNTIL_YEAR}. This world is in ${gameState?.currentYear ?? "an unknown year"}.`;
      return NextResponse.json({ started: false, reason: result.reason, message });
    }

    return NextResponse.json({
      started: true,
      level: result.level,
      crisisIds: result.crisisIds,
      message: `Vietnam chain started at rung ${result.level}. Both administrations have 24 hours to respond.`,
    });
  } catch (err) {
    return handleRouteError(err, { route: "POST /api/admin/crises/vietnam-start" });
  }
}
