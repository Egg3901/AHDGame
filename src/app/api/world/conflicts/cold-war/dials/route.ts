/**
 * GET /api/world/conflicts/cold-war/dials
 *
 * The Cold War console's dials as the server holds them. The console's boards
 * keep theirs in localStorage; this is the reading they hydrate from on load, so
 * two players looking at the same war see the same readiness.
 *
 * Public, like the conflicts hub it serves, and gated on the same
 * `conflictsEnabled` switch. A world with the subsystem off gets the peacetime
 * values rather than a 404, because the console's own routes are already gated
 * and a failed fetch there should leave the boards on their defaults, not break
 * them.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { getGameStateCollection } from "@/lib/db/collections";
import { getColdWarDials, PEACETIME_DIALS } from "@/lib/coldwar/dials";

export async function GET() {
  try {
    const db = await getDb();
    const gameState = await getGameStateCollection(db).then((col) =>
      col.findOne({ _id: "current" }, { projection: { conflictsEnabled: 1 } })
    );
    if (!gameState?.conflictsEnabled) {
      return NextResponse.json({ dials: PEACETIME_DIALS });
    }
    return NextResponse.json({ dials: await getColdWarDials(db) });
  } catch (error) {
    return handleRouteError(error, { route: "GET /api/world/conflicts/cold-war/dials" });
  }
}
