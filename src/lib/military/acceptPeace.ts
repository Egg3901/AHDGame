import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { PeaceOfferDoc } from "@/lib/db/types/peaceOffer";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import { getPeaceOffersCollection } from "@/lib/db/collections/peaceOffers";
import { standDownCountry } from "./leaveConflict";
import { recordTruce } from "./truce";
import { resolveConflict } from "./resolveConflict";
import { sideWouldEmpty } from "./peaceOffer";
import { principalOf } from "./principal";
import { applyPeaceTerm } from "./applyPeaceTerm";
import type { Side } from "./occupation";

export interface AcceptPeaceResult {
  /**
   * False when the offer was no longer pending by the time this ran, so nothing was
   * applied. Not an error — someone else got there first.
   */
  applied: boolean;
  /** True when the leaver was the last of its side, so the war ended outright. */
  resolved: boolean;
}

/**
 * Apply an accepted peace deal.
 *
 * The LEAVER is the country the deal takes out of the war, and it is now recorded on
 * the offer rather than assumed: an offer runs in both directions, so the sender may
 * be proposing to leave themselves OR asking the recipient to withdraw while they
 * stay in. The term's `payer` is a third, separate question, because either party
 * may be the one paying whichever way the deal runs.
 *
 * The RECIPIENT accepts either way. No government is removed from a war without its
 * own consent.
 *
 * Spec: docs/superpowers/specs/2026-08-04-suing-for-peace-design.md
 */
/**
 * Everyone a released ally was fighting, read from the roster it is leaving.
 *
 * `principal` is excluded: it is the country the ally came to defend, so they were never
 * at war with each other and a truce between them would be meaningless.
 *
 * ⚠️ Must be called BEFORE the rosters are spliced. Afterwards the answer is wrong in a
 * way that is silent: the ally simply walks away with fewer truces than it earned.
 */
function opposingRosterOf(
  conflict: Pick<ConflictDoc, "sideA" | "sideB">,
  ally: CountryId,
  principal: CountryId
): CountryId[] {
  const onA = conflict.sideA.countries.includes(ally);
  const enemies = onA ? conflict.sideB.countries : conflict.sideA.countries;
  return enemies.filter((c) => c !== principal && c !== ally);
}

/**
 * Which roster holds this country, or null when neither does.
 *
 * Roster-only, deliberately NOT `sideOf`: its bloc fallback can name a side the
 * country was never rostered on, and every caller here uses the answer to pick a
 * roster to edit or a victor to stamp.
 */
function rosterSideOf(
  conflict: Pick<ConflictDoc, "sideA" | "sideB">,
  country: CountryId
): Side | null {
  if ((conflict.sideA.countries as string[]).includes(country)) return "A";
  if ((conflict.sideB.countries as string[]).includes(country)) return "B";
  return null;
}

export async function acceptPeace(
  db: Db,
  offer: PeaceOfferDoc,
  conflict: ConflictDoc,
  currentTurn: number,
  acceptedBy: string
): Promise<AcceptPeaceResult> {
  const leaver = offer.leaver;
  // The party that stays. Read off the leaver rather than hardcoded, because either
  // of the two may be the one leaving.
  const other = leaver === offer.fromCountry ? offer.toCountry : offer.fromCountry;

  // Claiming the offer is the FIRST thing that happens, and it is conditional on the
  // offer still being pending. That single write is what stops a double-accept: two
  // simultaneous requests both pass the route's revalidation, but only one can move
  // this document off "pending", and the loser applies nothing. Without the status in
  // the filter, both would move the money.
  const claim = await getPeaceOffersCollection(db).updateOne(
    { _id: offer._id, status: "pending" },
    { $set: { status: "accepted", resolvedBy: acceptedBy, resolvedTurn: currentTurn } }
  );
  if (claim.modifiedCount === 0) return { applied: false, resolved: false };

  await applyPeaceTerm(db, offer.term, {
    imposer: offer.fromCountry,
    target: offer.toCountry,
    conflictId: conflict._id,
    currentTurn,
  });

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
          turn: currentTurn,
        },
      },
    }
  );

  // Treaty release: an ally pulled in to defend this country leaves with it. The war it
  // was brought into is over for the country it came for, and leaving it to fight on
  // alone would be a guarantee that outlives its own cause.
  //
  // Matched on `defending`, so an ally bound to a DIFFERENT member of the same alliance
  // stays exactly where it is.
  const rosters = [...conflict.sideA.countries, ...conflict.sideB.countries] as string[];
  const released = (conflict.treatyEntries ?? [])
    .filter((e) => e.defending === leaver)
    .map((e) => e.countryId)
    .filter((c) => rosters.includes(c));
  const leaving: CountryId[] = [leaver, ...released];

  // Captured NOW, before the splice loop below mutates the rosters. Read afterwards, the
  // principal is already gone from its side and a released ally would be truced against
  // the survivors only — or, when it was the last one out, against nobody at all.
  const enemiesByAlly = new Map<CountryId, CountryId[]>(
    released.map((ally) => [ally, opposingRosterOf(conflict, ally, leaver)])
  );

  // Compute BEFORE the roster edit below — afterwards the leavers are gone and the
  // side would read as already empty. Over the WHOLE leaving set, because a two-country
  // side can empty in one call now: asked about the principal alone this returns null and
  // the war sits active with an empty roster and no victor.
  const emptied = sideWouldEmpty(conflict, leaving);

  // THE PRINCIPAL-TO-PRINCIPAL RULE. A war between two founding belligerents is
  // THEIRS, and when both of them settle it the war ends for every guest on both
  // rosters — rather than leaving allies to fight on over a question the two
  // countries that started it have already answered between themselves.
  //
  // Read BEFORE the splice below, for the same reason as `emptied` and
  // `enemiesByAlly`: afterwards the leaver is gone from its roster and `principalOf`
  // names its SUCCESSOR, so the rule would quietly stop firing for the one case it
  // exists to catch.
  //
  // BOTH must be founders. A principal cannot lose its side's war to a guest that did
  // not start it, and in that deal the opposing principal is not a party at all.
  const leaverSide = rosterSideOf(conflict, leaver);
  const bothPrincipals =
    leaverSide !== null &&
    principalOf(conflict, leaverSide) === leaver &&
    principalOf(conflict, leaverSide === "A" ? "B" : "A") === other;

  for (const country of leaving) {
    await standDownCountry(db, conflict, country);
  }

  for (const country of leaving) {
    const side: Side | null = rosterSideOf(conflict, country);
    if (!side) continue;
    const path = `side${side}.countries` as const;
    await getConflictsCollection(db).updateOne({ _id: conflict._id }, {
      $pull: { [path]: country },
    } as never);
    // Keep the in-memory doc consistent for the rest of this call — resolveConflict
    // below reads the rosters, and a stale copy would truce a leaver again.
    const roster = side === "A" ? conflict.sideA.countries : conflict.sideB.countries;
    const at = roster.indexOf(country);
    if (at >= 0) roster.splice(at, 1);
  }

  await recordTruce(db, leaver, other, currentTurn);
  // A released ally did the fighting too. Without its own truce it would be
  // re-declarable the moment it left while the principal was protected — the same
  // argument resolveConflict makes for trucing every cross-side pair.
  for (const ally of released) {
    for (const enemy of enemiesByAlly.get(ally) ?? []) {
      await recordTruce(db, ally, enemy, currentTurn);
    }
  }

  // The side that LOST this war, by either road. `emptied` is by construction the
  // leaver's own side — the release set is drawn from it — so the two roads name the
  // same loser, and the victor is read off the LEAVER rather than off the sender.
  //
  // That distinction is the whole point. An offer runs in both directions: "I
  // withdraw" and "you withdraw" are one deal written from its two ends. Stamping the
  // sender as victor would hand the war to whichever government happened to compose
  // the offer, and award it to a principal that had just offered to quit.
  const losingSide = emptied ?? leaverSide;
  if (losingSide !== null && (emptied !== null || bothPrincipals)) {
    // resolveConflict truces every remaining cross-side pair, which is why the roster
    // edit above has to have happened first: the leaver already has its truce and must
    // not be included again with a later expiry.
    //
    // A negotiated WHITE PEACE names no victor either way. Both governments walked
    // away, and the record should say so — a settlement crisis frozen on this war
    // reads the stalemate and goes back on the board rather than being decided.
    await resolveConflict(
      db,
      conflict,
      offer.term.kind === "white_peace" ? "stalemate" : losingSide === "A" ? "B" : "A",
      currentTurn
    );
    return { applied: true, resolved: true };
  }
  return { applied: true, resolved: false };
}
