/**
 * Turn step: pay commissioned generals their tenure skill points.
 *
 * Battles were the only source of skill points, so an officer in a nation at peace
 * never developed at all. Command experience accrues in garrison too — one point per
 * `TENURE_POINT_TURNS` (one real day) of service, to a lifetime cap.
 *
 * Only COMMISSIONED generals accrue; a dismissed officer keeps their record for
 * re-appointment but is not serving, and must not be paid for the years they sat out.
 *
 * Idempotent within a turn: `accrueTenurePoints` advances the marker by the whole
 * intervals it actually paid, so re-running mid-tick grants nothing further.
 */
import type { Db } from "mongodb";
import { getCharacterGeneralsCollection } from "@/lib/db/collections/characterGenerals";
import { isCommissioned } from "@/lib/db/types/characterGeneral";
import { accrueTenurePoints } from "@/lib/military/generals";

export interface GeneralTenureResult {
  /** Generals whose profile was written (points paid, or clock started). */
  updated: number;
  /** Skill points handed out this tick. */
  pointsGranted: number;
}

export async function processGeneralTenure(
  db: Db,
  currentTurn: number
): Promise<GeneralTenureResult> {
  const col = getCharacterGeneralsCollection(db);
  const docs = await col.find({}).toArray();

  const ops = [];
  let pointsGranted = 0;
  for (const doc of docs) {
    if (!isCommissioned(doc) || !doc.general) continue;
    const next = accrueTenurePoints(doc.general, currentTurn);
    if (!next) continue;
    pointsGranted += (next.pts ?? 0) - (doc.general.pts ?? 0);
    ops.push({
      updateOne: {
        filter: { characterId: doc.characterId },
        update: { $set: { general: next } },
      },
    });
  }
  if (ops.length) await col.bulkWrite(ops);
  return { updated: ops.length, pointsGranted };
}
