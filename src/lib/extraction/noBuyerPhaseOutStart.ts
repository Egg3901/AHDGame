import type { Db } from "mongodb";
import type { GameConfig } from "@/lib/db/types";

/**
 * Start turn of the no-buyer extraction phase-out for this world.
 *
 * Read from `gameConfig.extractionNoBuyerPhaseOutStartTurn`. The first
 * corporation turn that finds it unset stamps the current turn, so the 24-turn
 * phase-out starts when the code deploys (or, on a fresh world, on its first
 * turn) rather than at a hard-coded turn every world would disagree on. The
 * conditional filter makes a retried turn reuse the first stamp. A world with
 * no gameConfig document gets no phase-out.
 */
export async function resolveNoBuyerPhaseOutStartTurn(
  db: Db,
  config: Pick<GameConfig, "extractionNoBuyerPhaseOutStartTurn"> | null | undefined,
  turn: number
): Promise<number | undefined> {
  if (!config) return undefined;
  const stamped = config.extractionNoBuyerPhaseOutStartTurn;
  if (typeof stamped === "number" && Number.isFinite(stamped)) return stamped;
  await db
    .collection<GameConfig>("gameConfig")
    .updateOne(
      { _id: "default", extractionNoBuyerPhaseOutStartTurn: { $exists: false } },
      { $set: { extractionNoBuyerPhaseOutStartTurn: turn } }
    );
  return turn;
}
