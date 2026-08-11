import { redirect } from "next/navigation";
import { getDb } from "@/lib/mongodb";
import { getGameStateCollection } from "@/lib/db/collections";

/**
 * Server gate for the Cold War section. Every `/world/conflicts` route calls
 * this; when the Conflicts subsystem is disabled it falls back to the World hub
 * rather than exposing the page. Mirrors the navbar-link gating.
 */
export async function requireConflictsEnabled(): Promise<void> {
  const db = await getDb();
  const gameState = await getGameStateCollection(db).then((col) =>
    col.findOne({ _id: "current" }, { projection: { conflictsEnabled: 1 } })
  );
  if (!gameState?.conflictsEnabled) redirect("/world");
}
