/**
 * GET /api/world/conflicts/feed
 *
 * Every live conflict as a card needs it: name, region, dated span, severity rung,
 * front-line status line, and casualty count. This is the richer sibling of
 * `/api/world/conflicts` (which returns only the picker DTO) and it feeds the merged
 * Global feed on the crises page, where wars sit alongside global crises.
 *
 * Public and gated on the same `conflictsEnabled` switch as the conflicts hub, so a
 * world with the subsystem off reports no conflicts rather than leaking a surface that
 * is not supposed to exist yet.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { getGameStateCollection } from "@/lib/db/collections";
import { listActiveConflicts } from "@/lib/db/collections/conflicts";
import { casualtiesByTheater } from "@/lib/db/collections/battleReports";
import { getGameTime } from "@/lib/time/gameTime";
import { toConflictView } from "@/app/world/conflicts/_coldwar/conflictView";

export async function GET() {
  try {
    const db = await getDb();
    const gameState = await getGameStateCollection(db).then((col) =>
      col.findOne({ _id: "current" }, { projection: { conflictsEnabled: 1 } })
    );
    if (!gameState?.conflictsEnabled) {
      return NextResponse.json({ conflicts: [] });
    }

    const { currentYear, startingYear, preIterationTurns } = await getGameTime();

    const docs = await listActiveConflicts(db);
    const casualties = await casualtiesByTheater(
      db,
      docs.map((d) => d._id)
    );
    const conflicts = docs.map((d) =>
      toConflictView(d, { startingYear, casualties: casualties[d._id] ?? 0, preIterationTurns })
    );

    return NextResponse.json({ conflicts, year: currentYear ?? startingYear });
  } catch (error) {
    return handleRouteError(error, { route: "GET /api/world/conflicts/feed" });
  }
}
