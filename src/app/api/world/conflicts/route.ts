/**
 * GET /api/world/conflicts
 *
 * Every live conflict, as the minimum a picker needs: the theater key, the public
 * number, the name, and each side's label. Public, like the conflicts hub it
 * mirrors — and gated on the same `conflictsEnabled` switch, so a world with the
 * subsystem off reports no conflicts rather than leaking them to a UI that is not
 * supposed to exist yet.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { getGameStateCollection } from "@/lib/db/collections";
import { listActiveConflicts } from "@/lib/db/collections/conflicts";
import type { ConflictOption } from "@/lib/military/dto/conflictOption";

export async function GET() {
  try {
    const db = await getDb();
    const gameState = await getGameStateCollection(db).then((col) =>
      col.findOne({ _id: "current" }, { projection: { conflictsEnabled: 1 } })
    );
    if (!gameState?.conflictsEnabled) {
      return NextResponse.json({ conflicts: [] });
    }

    const docs = await listActiveConflicts(db);
    const conflicts: ConflictOption[] = docs.map((d) => ({
      id: d._id,
      conflictId: d.conflictId,
      name: d.name,
      sideALabel: d.sideA.label,
      sideBLabel: d.sideB.label,
    }));

    return NextResponse.json({ conflicts });
  } catch (error) {
    return handleRouteError(error, { route: "GET /api/world/conflicts" });
  }
}
