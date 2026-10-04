import type { Db } from "mongodb";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { PeaceOfferDoc } from "@/lib/db/types/peaceOffer";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import { getPeaceOffersCollection } from "@/lib/db/collections/peaceOffers";
import { standDownCountry } from "./leaveConflict";
import { recordTruce } from "./truce";
import { resolveConflict } from "./resolveConflict";
import { applyPeaceTerm } from "./applyPeaceTerm";
import { buildPeaceApplicationPlan } from "./rules/peaceApplication";

export interface AcceptPeaceResult {
  /** False when another request claimed this still-pending offer first. */
  applied: boolean;
  /** True when this settlement ends the whole conflict. */
  resolved: boolean;
}

/**
 * Claim or resume an accepted peace deal.
 *
 * The acceptance plan is frozen on the offer before world state changes. A failed
 * request can therefore resume from its durable phase without reapplying an
 * indemnity or inferring different leavers from a partly edited conflict roster.
 */

export async function acceptPeace(
  db: Db,
  offer: PeaceOfferDoc,
  conflict: ConflictDoc,
  currentTurn: number,
  acceptedBy: string
): Promise<AcceptPeaceResult> {
  let application = offer.application;
  if (offer.status === "pending") {
    application = buildPeaceApplicationPlan(offer, conflict, currentTurn, acceptedBy);
    const claim = await getPeaceOffersCollection(db).updateOne(
      { _id: offer._id, status: "pending" },
      {
        $set: {
          status: "accepted",
          resolvedBy: acceptedBy,
          resolvedTurn: currentTurn,
          application,
        },
      }
    );
    if (claim.modifiedCount === 0) return { applied: false, resolved: false };
  } else if (offer.status !== "accepted" || !application) {
    return { applied: false, resolved: false };
  }

  if (!(["claimed", "term_applied", "completed"] as const).includes(application.phase)) {
    throw new Error(`Cannot resume peace offer ${offer._id}: invalid application phase`);
  }

  if (application.phase === "completed") {
    return { applied: true, resolved: application.resolutionWinner !== null };
  }

  if (application.phase === "claimed") {
    await applyPeaceTerm(db, offer.term, {
      imposer: offer.fromCountry,
      target: offer.toCountry,
      conflictId: conflict._id,
      currentTurn: application.acceptedTurn,
      peaceOfferId: offer._id,
    });
    // Positive indemnities advance the phase with both treasury legs. Replica sets
    // commit them together; standalone Mongo makes each leg replay-safe with a
    // treasury-local receipt. Other terms are idempotent or independently resumable.
    if (offer.term.kind !== "indemnity" || !(offer.term.amount > 0)) {
      await getPeaceOffersCollection(db).updateOne(
        { _id: offer._id, status: "accepted", "application.phase": "claimed" },
        { $set: { "application.phase": "term_applied" } }
      );
    }
    application.phase = "term_applied";
  }

  // Stamp what this settlement took, so the war wire can report it. Written here
  // rather than posted here: this runs on a request path, and a news post made from
  // a request would fire again on a retry, which is the same reason the settlement
  // crisis posts from a tick. `emitWarWire` sweeps the stamp on the next turn.
  await getConflictsCollection(db).updateOne(
    { _id: conflict._id },
    {
      $set: {
        settlement: {
          term: offer.term,
          path: "negotiated" as const,
          // The term is always what was asked OF THE RECIPIENT, whichever party the
          // deal removes: "I leave and you demilitarise" and "you leave and you
          // demilitarise" both land on the same country. That keeps the stamp, the
          // wire and `applyPeaceTerm` reading the term the same way.
          imposedBy: offer.fromCountry,
          target: offer.toCountry,
          turn: application.acceptedTurn,
        },
      },
    }
  );

  for (const { countryId } of application.leavers) {
    await standDownCountry(db, conflict, countryId);
  }

  for (const { countryId, side } of application.leavers) {
    const path = `side${side}.countries` as const;
    await getConflictsCollection(db).updateOne({ _id: conflict._id }, {
      $pull: { [path]: countryId },
    } as never);
    // Keep the in-memory doc consistent for the rest of this call — resolveConflict
    // below reads the rosters, and a stale copy would truce a leaver again.
    const roster = side === "A" ? conflict.sideA.countries : conflict.sideB.countries;
    const at = roster.indexOf(countryId);
    if (at >= 0) roster.splice(at, 1);
  }

  for (const pair of application.trucePairs) {
    await recordTruce(db, pair.first, pair.second, application.acceptedTurn);
  }

  if (application.resolutionWinner !== null) {
    await resolveConflict(db, conflict, application.resolutionWinner, application.acceptedTurn, {
      endingType: "peace",
      attackerNation: application.attackerNation,
      defenderNation: application.defenderNation,
    });
  }

  await getPeaceOffersCollection(db).updateOne(
    { _id: offer._id, status: "accepted", "application.phase": "term_applied" },
    { $set: { "application.phase": "completed" } }
  );
  application.phase = "completed";

  return { applied: true, resolved: application.resolutionWinner !== null };
}
