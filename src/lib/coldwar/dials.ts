import type { Db } from "mongodb";
import {
  deriveVietnamDials,
  getVietnamEscalation,
  type VietnamDials,
} from "@/lib/crises/vietnamEscalation";
import { getGameState } from "@/lib/gameState";
import { livingVietnamAsLegacyState } from "@/lib/livingConflict/vietnamCompat";

/**
 * The Cold War console's dials, as the server holds them.
 *
 * The console's boards were built as a static design port: every dial lives in
 * localStorage, which makes each browser its own private world. That is fine for
 * a mockup and wrong for a shared game, because two players looking at the same
 * war saw different readiness levels.
 *
 * This is the smallest honest correction. The server derives the dials from real
 * persisted state (today, the Vietnam escalation ladder) and the console hydrates
 * from it on load. localStorage stays, demoted to a cache: it is what the boards
 * read between renders and what keeps a board's own in-session adjustments alive,
 * but it is overwritten by the server's reading every time the section loads. The
 * boards themselves are untouched.
 */

export interface ColdWarDials {
  /** Global readiness, 1 (imminent) to 5 (calm). */
  defcon: number;
  /** Bloc cohesion, 0-100, per side. */
  cohesionWest: number;
  cohesionEast: number;
  /** 0-100 war weariness at home. */
  warWeariness: number;
  /** Multiplier on baseline defence procurement demand. */
  procurementMultiplier: number;
  /** Detente goodwill penalty, 0-60. */
  detenteGoodwillPenalty: number;
  /**
   * Where these numbers came from. `"vietnam"` when a war is on the ladder,
   * `"peacetime"` when nothing is driving them and they are the console's own
   * resting values. The UI does not have to guess whether a calm reading is real.
   */
  source: "vietnam" | "peacetime";
}

/** The console's resting values with no war anywhere. Mirrors its own defaults. */
export const PEACETIME_DIALS: ColdWarDials = {
  defcon: 5,
  cohesionWest: 60,
  cohesionEast: 60,
  warWeariness: 0,
  procurementMultiplier: 1,
  detenteGoodwillPenalty: 0,
  source: "peacetime",
};

function fromVietnam(dials: VietnamDials): ColdWarDials {
  return {
    defcon: dials.defcon,
    cohesionWest: dials.cohesionWest,
    cohesionEast: dials.cohesionEast,
    warWeariness: dials.warWeariness,
    procurementMultiplier: dials.procurementMultiplier,
    detenteGoodwillPenalty: dials.detenteGoodwillPenalty,
    source: "vietnam",
  };
}

/**
 * Read the console's dials off server state.
 *
 * Only the Vietnam ladder feeds them today. When a second driver arrives (a
 * Berlin or Cuba ladder, say) it composes here, taking the tightest reading
 * across drivers rather than the last one to write.
 */
export async function getColdWarDials(db: Db): Promise<ColdWarDials> {
  const gameState = await getGameState(db);
  const vietnam = gameState?.livingConflictsEnabled
    ? await livingVietnamAsLegacyState(db)
    : await getVietnamEscalation(db);
  if (vietnam.level <= 0) return PEACETIME_DIALS;
  return fromVietnam(deriveVietnamDials(vietnam));
}
