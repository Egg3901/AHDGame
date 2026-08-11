import type { Db } from "mongodb";
import type { PeaceOfferDoc } from "@/lib/db/types/peaceOffer";
import type { CountryId } from "@/lib/constants/countries";
import { isOfferLive } from "@/lib/military/peaceOffer";

const COLLECTION = "peaceOffers";

export function getPeaceOffersCollection(db: Db) {
  return db.collection<PeaceOfferDoc>(COLLECTION);
}

/**
 * The live offer for this exact triple, if one exists.
 *
 * One live offer per `(conflictId, fromCountry, toCountry)`: re-offering means
 * withdrawing first, so a country cannot paper the recipient with variants. The
 * triple is DIRECTIONAL on purpose — CN may hold an open offer to the UK while the
 * UK's offer to CN is also pending, because each is proposing its own terms.
 *
 * Filters in memory rather than querying `status: "pending"`, because a row can be
 * stored as pending and still be expired. `isOfferLive` is the authority.
 */
export async function findLiveOffer(
  db: Db,
  conflictId: string,
  fromCountry: CountryId,
  toCountry: CountryId,
  currentTurn: number
): Promise<PeaceOfferDoc | null> {
  const rows = await getPeaceOffersCollection(db)
    .find({ conflictId, fromCountry, toCountry, status: "pending" })
    .toArray();
  return rows.find((o) => isOfferLive(o, currentTurn)) ?? null;
}

/**
 * Every offer touching this country across these wars, newest first — both
 * directions, and including resolved ones so a player can see what they already
 * turned down.
 *
 * Takes a LIST of wars rather than one, because the negotiator's surface shows every
 * war the country is in at once and a call per war would be a fan-out for nothing.
 */
export async function listOffersForCountry(
  db: Db,
  conflictIds: string[],
  countryId: CountryId
): Promise<PeaceOfferDoc[]> {
  if (conflictIds.length === 0) return [];
  return getPeaceOffersCollection(db)
    .find({
      conflictId: { $in: conflictIds },
      $or: [{ fromCountry: countryId }, { toCountry: countryId }],
    })
    .sort({ offeredTurn: -1 })
    .toArray();
}

/**
 * Flip stale `pending` rows to `expired` opportunistically, so documents converge
 * without a scheduled sweeper. Never the authority on whether an offer is live —
 * that is always `isOfferLive` — just bookkeeping done while we are here.
 */
export async function reapExpiredOffers(
  db: Db,
  offers: PeaceOfferDoc[],
  currentTurn: number
): Promise<void> {
  const stale = offers.filter((o) => o.status === "pending" && !isOfferLive(o, currentTurn));
  if (stale.length === 0) return;
  await getPeaceOffersCollection(db).updateMany(
    { _id: { $in: stale.map((o) => o._id) } },
    { $set: { status: "expired" } }
  );
}
