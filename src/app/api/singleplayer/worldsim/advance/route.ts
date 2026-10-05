import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { requireSingleplayer } from "@/lib/api/requireSingleplayer";
import { getDb } from "@/lib/mongodb";
import { parseJsonBody } from "@/lib/api/validate";
import { advanceWorldsim, MAX_WORLD_SIM_BATCH_TURNS } from "@/lib/singleplayerWorld";
import { getSingleplayerWorldAvailability } from "@/lib/singleplayerOperator";
import { getSingleplayerConfig } from "@/lib/singleplayerServer";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const bodySchema = z.object({
  turns: z.number().int().min(1).max(MAX_WORLD_SIM_BATCH_TURNS),
});

/** Advance the local world through the authoritative turn engine. */
export async function POST(request: Request) {
  const denied = requireSingleplayer(request);
  if (denied) return denied;
  try {
    const db = await getDb();
    const config = await getSingleplayerConfig(db);
    if (config?.mode !== "worldsim") {
      return errorResponse(409, "Worldsim mode is not configured");
    }
    if ((await getSingleplayerWorldAvailability(db)) !== "off") {
      return errorResponse(409, "Resume the world before ending a turn.");
    }
    const playerCount = await db
      .collection("characters")
      .countDocuments({ retiredAt: { $exists: false } });
    if (playerCount > 0) {
      return errorResponse(409, "Worldsim mode requires a playerless world");
    }
    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }
    return NextResponse.json(await advanceWorldsim(parsed.data.turns), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
