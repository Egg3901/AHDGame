import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { requireSingleplayer } from "@/lib/api/requireSingleplayer";
import { getDb } from "@/lib/mongodb";
import { getSingleplayerConfig } from "@/lib/singleplayerServer";
import { canOperateSingleplayerWorld } from "@/lib/singleplayerOperator";
import { processTurn } from "@/lib/turnSystem";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(request: Request) {
  const denied = requireSingleplayer(request);
  if (denied) return denied;
  if (!canOperateSingleplayerWorld())
    return NextResponse.json({ error: "Singleplayer operator is unavailable" }, { status: 403 });
  try {
    const config = await getSingleplayerConfig(await getDb());
    if (!config || config.mode === "worldsim")
      return NextResponse.json({ error: "A player world is not configured" }, { status: 409 });
    const started = performance.now();
    const result = await processTurn();
    if (!result.success || result.turn <= 0)
      return NextResponse.json({ error: result.message }, { status: 500 });
    return NextResponse.json({
      success: true,
      turn: result.turn,
      message: result.message,
      durationSeconds: Math.round((performance.now() - started) / 100) / 10,
      warnings: result.warnings.slice(0, 10),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
