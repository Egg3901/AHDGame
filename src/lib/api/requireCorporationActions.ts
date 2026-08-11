import { NextResponse } from "next/server";
import type { Db } from "mongodb";
import { getGameStateCollection } from "@/lib/db/collections";

/**
 * Full-game pause gate (`gameState.isActive === false`): admin stop, auto-drift
 * pause, or pre-start / pre-launch worlds. Same signal and message as
 * `executeAction` / influence — not the narrower `corporationActionsPaused` flag.
 *
 * Do NOT use this on corporation founding or CEO corp-mutation routes. Turns may
 * be paused on purpose during registration / settling windows so players can
 * still found companies and place first plants (ticket #1009; #1004 over-gated).
 * Political spends and reputation influence keep their own `isActive` checks.
 */
export async function requireGameActive(db: Db): Promise<NextResponse | null> {
  const col = await getGameStateCollection(db);
  const gameState = await col.findOne({ _id: "current" }, { projection: { isActive: 1 } });

  if (gameState && gameState.isActive === false) {
    return NextResponse.json({ error: "The game is currently paused." }, { status: 409 });
  }

  return null;
}

/**
 * Blocks CEO corp mutations while an admin has paused corporation actions.
 *
 * Intentionally does NOT consult `gameState.isActive`. A turns-paused world
 * (registration settle, launch staging) must still allow founding and plant
 * placement; only the corp-actions kill switch freezes existing CEOs.
 *
 * Corp *founding* (`POST /api/corporations`) stays exempt from this guard
 * entirely — callers there must not invoke it.
 */
export async function requireCorporationActionsEnabled(db: Db): Promise<NextResponse | null> {
  const col = await getGameStateCollection(db);
  const gameState = await col.findOne(
    { _id: "current" },
    { projection: { corporationActionsPaused: 1 } }
  );

  if (gameState?.corporationActionsPaused) {
    return NextResponse.json(
      { error: "Corporation actions are currently paused by an admin" },
      { status: 403 }
    );
  }

  return null;
}
