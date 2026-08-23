import type { Db } from "mongodb";
import {
  deriveVietnamDials,
  getVietnamEscalation,
  type VietnamDials,
} from "@/lib/crises/vietnamEscalation";
import { getGameState } from "@/lib/gameState";
import { livingVietnamAsLegacyState } from "@/lib/livingConflict/vietnamCompat";
import { getColdWarTension, TENSION_BASELINE } from "@/lib/coldwar/tension";

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
  source: "vietnam" | "tension" | "peacetime";
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

/** DEFCON implied by a tension reading. Tension alone never reaches DEFCON 1. */
export function defconFromTension(tension: number): number {
  if (tension >= 85) return 2;
  if (tension >= 65) return 3;
  if (tension >= 45) return 4;
  return 5;
}

/** The dials a bare tension reading implies, with no war on any ladder. */
export function fromTension(tension: number): ColdWarDials {
  return {
    defcon: defconFromTension(tension),
    cohesionWest: PEACETIME_DIALS.cohesionWest,
    cohesionEast: PEACETIME_DIALS.cohesionEast,
    warWeariness: 0,
    procurementMultiplier: 1 + Math.max(0, tension - TENSION_BASELINE) * 0.005,
    detenteGoodwillPenalty: Math.round(Math.max(0, tension - 35) * 0.75),
    source: "tension",
  };
}

/**
 * Tightest reading across the war ladder and the tension driver. Tension only
 * drives readiness, procurement and detente goodwill; cohesion and weariness
 * are the war's own story and pass through untouched.
 */
function tightest(war: ColdWarDials, tension: ColdWarDials): ColdWarDials {
  return {
    ...war,
    defcon: Math.min(war.defcon, tension.defcon),
    procurementMultiplier: Math.max(war.procurementMultiplier, tension.procurementMultiplier),
    detenteGoodwillPenalty: Math.max(war.detenteGoodwillPenalty, tension.detenteGoodwillPenalty),
  };
}

/**
 * Read the console's dials off server state.
 *
 * Two drivers feed them: the war ladder (legacy or living-conflict Vietnam)
 * and the global tension reading. They compose by taking the tightest reading
 * across drivers, dial by dial, rather than the last one to write.
 */
export async function getColdWarDials(db: Db): Promise<ColdWarDials> {
  const gameState = await getGameState(db);
  const [vietnam, tension] = await Promise.all([
    gameState?.livingConflictsEnabled ? livingVietnamAsLegacyState(db) : getVietnamEscalation(db),
    getColdWarTension(db),
  ]);
  const tensionDials =
    tension.value > TENSION_BASELINE ? fromTension(tension.value) : PEACETIME_DIALS;
  if (vietnam.level <= 0) return tensionDials;
  return tightest(fromVietnam(deriveVietnamDials(vietnam)), tensionDials);
}
