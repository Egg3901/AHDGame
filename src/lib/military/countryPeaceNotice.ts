import type { Db, Filter, ObjectId } from "mongodb";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { CountryId } from "@/lib/constants/countries";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import { getPeaceOffersCollection } from "@/lib/db/collections/peaceOffers";
import { requirePeaceNegotiator } from "@/lib/api/requirePeaceNegotiator";
import { isOfferLive } from "@/lib/military/peaceOffer";

/**
 * What the peace strip should say on this country's pages, for THIS reader.
 *
 * Three actionable states, in the order they matter. Null when there is nothing for
 * this reader to do, which is the common case.
 */
export type CountryPeaceNotice =
  | {
      /** We have won a war outright and hold a window in which to name our terms. */
      kind: "window_open";
      warName: string;
      /** Public conflict number, for the link. */
      conflictNumber: number | null;
      turnsLeft: number;
    }
  | {
      /** Somebody has offered us terms and is waiting on an answer. */
      kind: "offer_incoming";
      count: number;
    }
  | {
      /** We are at war and could open talks. Nothing is pending. */
      kind: "can_offer";
    };

/**
 * Load the peace strip's state for one reader.
 *
 * SEAT GATED, unlike the wartime strip beside it, and the asymmetry is deliberate.
 * A war is a fact about the country, so every reader of its pages is told. An offer
 * is a decision in front of one person: showing every citizen a call to action they
 * cannot take turns a prompt into noise. So this returns null for anyone who does
 * not hold the seat.
 *
 * The seat test is `requirePeaceNegotiator`, the same function the peace routes use,
 * so the strip and the buttons it links to can never disagree about who may act.
 *
 * Returns null and never throws for a logged-out reader: `characterId` is null and
 * there is no seat to check.
 */
export async function loadCountryPeaceNotice(
  db: Db,
  countryId: CountryId,
  characterId: ObjectId | null,
  isAdmin: boolean,
  currentTurn: number
): Promise<CountryPeaceNotice | null> {
  if (!characterId) return null;
  const gate = await requirePeaceNegotiator(db, countryId, characterId, isAdmin);
  if (!gate.ok) return null;

  const live = await getConflictsCollection(db)
    .find({
      status: { $ne: "resolved" },
      $or: [{ "sideA.countries": countryId }, { "sideB.countries": countryId }],
    } as Filter<ConflictDoc>)
    .toArray();
  if (live.length === 0) return null;

  // A won war outranks a pending offer: the window closes on a clock and the offer
  // does not, so it is the one that costs something to miss.
  const won = live.find(
    (c) => c.status === "terms_pending" && c.termsWindow?.imposer === countryId
  );
  if (won?.termsWindow) {
    return {
      kind: "window_open",
      warName: won.name,
      conflictNumber: won.conflictId ?? null,
      // Floored at zero so a window the sweeper has not yet reached never renders a
      // negative countdown.
      turnsLeft: Math.max(0, won.termsWindow.closesTurn - currentTurn),
    };
  }

  const offers = await getPeaceOffersCollection(db)
    .find({ conflictId: { $in: live.map((c) => c._id) }, toCountry: countryId })
    .toArray();
  // Derived liveness, never the stored status: a row can say "pending" and be long
  // expired, which is the rule `isOfferLive` exists to enforce.
  const incoming = offers.filter((o) => isOfferLive(o, currentTurn));
  if (incoming.length > 0) return { kind: "offer_incoming", count: incoming.length };

  // At war with nothing pending. Only offered while a war is actually negotiable:
  // a war awaiting terms has already been decided.
  const negotiable = live.some((c) => c.status !== "terms_pending");
  return negotiable ? { kind: "can_offer" } : null;
}
