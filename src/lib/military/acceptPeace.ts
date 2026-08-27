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
 * The LEAVER is the country the deal takes out of the war. An offer is always a
 * proposal to end the offerer's own participation, so the leaver is `fromCountry` —
 * `indemnity.payer` is a separate question, because either party may be the one
 * paying.
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

export async function acceptPeace(
  db: Db,
  offer: PeaceOfferDoc,
  conflict: ConflictDoc,
  currentTurn: number,
  acceptedBy: string
): Promise<AcceptPeaceResult> {
  const leaver = offer.fromCountry;
  const other = offer.toCountry;

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

  for (const country of leaving) {
    await standDownCountry(db, conflict, country);
  }

  for (const country of leaving) {
    // Roster-only, deliberately NOT `sideOf`: its bloc fallback could name a side the
    // country was never rostered on, and this value picks which roster to edit.
    const side: Side | null = conflict.sideA.countries.includes(country)
      ? "A"
      : conflict.sideB.countries.includes(country)
        ? "B"
        : null;
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

  if (emptied) {
    // The side the leaver was on is now empty, so the other side won. resolveConflict
    // truces every remaining cross-side pair, which is why the roster edit above has
    // to have happened first: the leaver already has its truce and must not be
    // included again with a later expiry.
    // A negotiated WHITE PEACE names no victor, even though one side's roster is the
    // one that emptied. Both governments walked away, and the record should say so.
    await resolveConflict(
      db,
      conflict,
      offer.term.kind === "white_peace" ? "stalemate" : emptied === "A" ? "B" : "A",
      currentTurn
    );
    return { applied: true, resolved: true };
  }
  return { applied: true, resolved: false };
}
