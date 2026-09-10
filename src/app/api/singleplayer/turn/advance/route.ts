import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { requireSingleplayer } from "@/lib/api/requireSingleplayer";
import { getDb } from "@/lib/mongodb";
import { getSingleplayerConfig } from "@/lib/singleplayerServer";
import { ObjectId } from "mongodb";
import { SINGLEPLAYER_USER_ID } from "@/lib/singleplayer";
import { getSingleplayerWorldAvailability } from "@/lib/singleplayerOperator";
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

    const character = await db
      .collection("characters")
      .findOne(
        { userId: new ObjectId(SINGLEPLAYER_USER_ID), retiredAt: { $exists: false } },
        { projection: { _id: 1, funds: 1, currencyBalances: 1, actions: 1 } }
      );
    if (!character) {
      return NextResponse.json(
        { error: "Create a character before ending a turn." },
        { status: 409 }
      );
    }

    if ((await getSingleplayerWorldAvailability(db)) !== "off") {
      return NextResponse.json(
        { error: "Resume the world before ending a turn." },
        { status: 409 }
      );
    }
    const started = performance.now();
    const result = await processTurn();
    if (result.turn <= 0) {
      return NextResponse.json({ error: result.message }, { status: 500 });
    }

    const updated = await db
      .collection("characters")
      .findOne(
        { _id: character._id },
        { projection: { funds: 1, currencyBalances: 1, actions: 1 } }
      );
    const beforeFunds = character.currencyBalances?.campaign ?? character.funds ?? 0;
    const afterFunds = updated?.currencyBalances?.campaign ?? updated?.funds ?? beforeFunds;
    const briefing = {
      funds: afterFunds,
      fundsDelta: afterFunds - beforeFunds,
      actions: updated?.actions ?? character.actions ?? 0,
      actionsDelta: (updated?.actions ?? character.actions ?? 0) - (character.actions ?? 0),
    };

    return NextResponse.json({
      success: true,
      briefing,
      turn: result.turn,
      message: result.message,
      durationSeconds: Math.round((performance.now() - started) / 100) / 10,
      ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
