import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireSingleplayer } from "@/lib/api/requireSingleplayer";
import { readWorldsimStats } from "@/lib/singleplayerWorldServer";

export const dynamic = "force-dynamic";

/**
 * Read-only spectator snapshot for a local world. The embedding client owns
 * the local-session gate; this route deliberately has no hosted auth bypass.
 */
export async function GET(request: Request) {
  const denied = requireSingleplayer(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await readWorldsimStats(await getDb()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
