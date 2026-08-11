import type { Db } from "mongodb";
import { isAutoDisastersEnabled } from "@/lib/crises/featureFlag";
import { processAutoDisasterSpawn } from "@/lib/crises/autoDisasterSpawn";
import { getSimulatedCountryIds } from "@/lib/countryAccess";

export async function processAutoDisasterTurn(
  db: Db,
  turn: number,
  preloadedGameState?: { autoDisastersEnabled?: boolean; autoCrisisPaused?: boolean }
): Promise<void> {
  const enabled = await isAutoDisastersEnabled(preloadedGameState);
  if (!enabled) return;
  // Temporary pause: stay enabled but spawn nothing new this turn.
  if (preloadedGameState?.autoCrisisPaused === true) return;

  // Enumerate via the canonical access helper, not a raw
  // `countryGameStates.find({ isActive: true })`: those docs are created lazily
  // and never carry `isActive`, and the US has no doc at all (it lives on the
  // global gameState). The old query matched zero countries, so the spawner
  // never fired in practice.
  // Status-based, not player-enablement: these fire wherever the engine is
  // simulating, including countries deliberately closed to players.
  const countryIds = await getSimulatedCountryIds(db);
  for (const countryId of countryIds) {
    await processAutoDisasterSpawn(db, countryId, turn, { enabled: true });
  }
}
