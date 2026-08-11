import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { closeCeoTenure } from "./ceoHistory";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";

export function doesCeoResideAtHeadquarters(
  homeState: string | null | undefined,
  headquartersState: string | null | undefined
): boolean {
  return !!homeState && !!headquartersState && homeState === headquartersState;
}

export async function vacateCorporationCeo(
  db: Db,
  corporationId: ObjectId,
  now: Date = new Date()
) {
  // Capture the outgoing CEO before unsetting so we can close their tenure.
  const existing = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: corporationId }, { projection: { ceoId: 1 } });
  await db.collection<Corporation>("corporations").updateOne(
    { _id: corporationId },
    {
      $set: { ceoVacant: true, updatedAt: now },
      $unset: { ceoId: "", userId: "" },
    }
  );
  if (existing?.ceoId) {
    await closeCeoTenure(db, corporationId, {
      holderId: existing.ceoId,
      turn: await getCurrentTurn(db),
    });
  }
}

export async function findActiveResidentCeoCorporation(
  db: Db,
  ceoId: ObjectId,
  homeState: string
): Promise<Corporation | null> {
  const corporation = await db.collection<Corporation>("corporations").findOne({
    ceoId,
    ceoVacant: { $ne: true },
  });
  if (!corporation) return null;

  // National Corporations have RELAXED country-level residency: their CEO need not
  // reside in the HQ state. They are also not eligible for combined relocation,
  // so report null without vacating.
  if (isStateOwned(corporation)) return null;

  if (doesCeoResideAtHeadquarters(homeState, corporation.headquartersState)) {
    return corporation;
  }

  // CEO no longer resides at HQ — not eligible for combined relocation.
  // We do NOT vacate here: this function is called from both GET (preview) and
  // POST (action) contexts, and mutating on a read causes the relocation dialog
  // to silently strip CEO status just from page load (bug #0813). Vacating is
  // the responsibility of the route that is actually performing the move:
  // performRelocation (character relocate), relocateHeadquarters (corp relocate),
  // and the admin HQ route all handle this explicitly.
  return null;
}
