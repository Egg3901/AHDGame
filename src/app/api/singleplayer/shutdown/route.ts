import { NextResponse } from "next/server";
import { requireSingleplayer } from "@/lib/api/requireSingleplayer";
import { getMongoClient } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

/**
 * Stop the local MongoDB cleanly. The launcher calls this before it exits.
 *
 * Why the app does this and not the launcher: the launcher is dependency-free
 * and cannot speak the wire protocol, and Windows has no signal that asks
 * mongod to checkpoint. A hard stop there loses the last hundred milliseconds
 * of acknowledged writes, which after "end turn" is exactly the write that
 * says the turn finished, so the world reopened mid-turn. The shutdown command
 * flushes the journal and checkpoints on every platform.
 *
 * Only exists in singleplayer, only on loopback (requireSingleplayer). On a
 * hosted copy the route is a 404 before anything runs.
 */
export async function POST(request: Request) {
  const denied = requireSingleplayer(request);
  if (denied) return denied;
  try {
    const client = await getMongoClient();
    await client.db("admin").command({ shutdown: 1 });
  } catch (error) {
    // mongod drops every connection as it exits, so the driver reports the
    // successful shutdown as a closed connection. Anything else is a failure.
    if (!isConnectionDrop(error)) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export function isConnectionDrop(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "MongoNetworkError" ||
    error.name === "MongoServerSelectionError" ||
    error.name === "MongoTopologyClosedError" ||
    /connection .*closed|ECONNRESET|socket hang up|shutdown in progress/i.test(error.message)
  );
}
