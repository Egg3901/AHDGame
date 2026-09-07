import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { requireSingleplayer } from "@/lib/api/requireSingleplayer";
import { getDb } from "@/lib/mongodb";
import { getSingleplayerConfig } from "@/lib/singleplayerServer";
import { processTurn } from "@/lib/turnSystem";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

/** Advance one normal local-world turn without granting any staff capability. */
export async function POST(request: Request) {
  const denied = requireSingleplayer(request);
  if (denied) return denied;
  try {
    const db = await getDb();
    const config = await getSingleplayerConfig(db);
    if (!config || config.mode === "worldsim") {
      return NextResponse.json({ error: "A player world is not configured" }, { status: 409 });
    }

    const started = performance.now();
    const result = await processTurn();
    if (!result.success || result.turn <= 0) {
      return NextResponse.json({ error: result.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      turn: result.turn,
      message: result.message,
      durationSeconds: Math.round((performance.now() - started) / 100) / 10,
      ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
