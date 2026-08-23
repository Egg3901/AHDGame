import type { Db } from "mongodb";
import type { MigrationResult } from "../../src/lib/migrations/types";
import { seedColdWarFoundations } from "../../src/lib/admin/seed/seedColdWarFoundations";
import type { GameState } from "../../src/lib/db/types/gameState";

export async function runSeedGlobalResponseFoundations(
  db: Db,
  opts: { dryRun?: boolean } = {}
): Promise<MigrationResult> {
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { currentYear: 1, startingYear: 1, currentTurn: 1 } }
    );
  const year = gameState?.currentYear ?? gameState?.startingYear;
  if (!Number.isFinite(year)) {
    return { notes: ["No usable game year; no Cold War foundation state was written."] };
  }
  const result = await seedColdWarFoundations(
    db,
    Number(year),
    Number(gameState?.currentTurn ?? 0),
    opts
  );
  return {
    documentsInserted:
      result.programsInserted +
      result.doctrineRowsInserted +
      result.conflictsInserted +
      (result.tensionInserted ? 1 : 0),
    documentsUpdated: result.doctrineRowsUpdated + result.campaignsUpdated + (opts.dryRun ? 0 : 1),
    notes: [
      `Nuclear programmes inserted: ${result.programsInserted}.`,
      `Doctrine rows inserted: ${result.doctrineRowsInserted}; completed: ${result.doctrineRowsUpdated}.`,
      `Campaign rows inserted: ${result.conflictsInserted}.`,
      `Legacy campaign rows completed: ${result.campaignsUpdated}.`,
      `Tension inserted: ${result.tensionInserted}.`,
      opts.dryRun ? "Dry run: no writes performed." : "Release 1.3 conflict flags enabled.",
    ],
  };
}
