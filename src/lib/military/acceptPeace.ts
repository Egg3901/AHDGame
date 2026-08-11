import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { PeaceOfferDoc } from "@/lib/db/types/peaceOffer";
import type { FederalBudget } from "@/lib/db/types";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import { getPeaceOffersCollection } from "@/lib/db/collections/peaceOffers";
import { convertLocal } from "@/lib/internationalOrganizations/organizationFund";
import { loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { ensureFederalBudget } from "@/lib/turn/ensureFederalBudget";
import { standDownCountry } from "./leaveConflict";
import { recordTruce } from "./truce";
import { resolveConflict } from "./resolveConflict";
import { sideWouldEmpty } from "./peaceOffer";
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

  await moveIndemnity(db, offer);

  // Compute BEFORE the roster edit below — afterwards the leaver is gone and the
  // side would read as already empty (or, for a two-country side, not empty at all).
  const emptied = sideWouldEmpty(conflict, leaver);
  // Roster-only, deliberately NOT `sideOf`: its bloc fallback could name a side the
  // leaver was never rostered on, and this value picks which roster to edit.
  const leaverSide: Side | null = conflict.sideA.countries.includes(leaver)
    ? "A"
    : conflict.sideB.countries.includes(leaver)
      ? "B"
      : null;

  await standDownCountry(db, conflict, leaver);

  if (leaverSide) {
    const path = `side${leaverSide}.countries` as const;
    await getConflictsCollection(db).updateOne({ _id: conflict._id }, {
      $pull: { [path]: leaver },
    } as never);
    // Keep the in-memory doc consistent for the rest of this call — resolveConflict
    // below reads the rosters, and a stale copy would truce the leaver again.
    const roster = leaverSide === "A" ? conflict.sideA.countries : conflict.sideB.countries;
    const at = roster.indexOf(leaver);
    if (at >= 0) roster.splice(at, 1);
  }

  await recordTruce(db, leaver, other, currentTurn);

  if (emptied) {
    // The side the leaver was on is now empty, so the other side won. resolveConflict
    // truces every remaining cross-side pair, which is why the roster edit above has
    // to have happened first: the leaver already has its truce and must not be
    // included again with a later expiry.
    await resolveConflict(db, conflict, emptied === "A" ? "B" : "A", currentTurn);
    return { applied: true, resolved: true };
  }
  return { applied: true, resolved: false };
}

/**
 * Move the indemnity, once.
 *
 * The amount is quoted in the PAYER's local currency, so it is debited as quoted and
 * CONVERTED before it is credited — every treasury is denominated locally, and moving
 * the raw number would invent or destroy value at the exchange rate. `convertLocal`
 * is a no-op for a same-currency pair, so it is called unconditionally rather than
 * guarded; guarding is how a double conversion gets written.
 *
 * `$inc` on `treasuryBalance` only. `debt.principal` is a DERIVED mirror
 * (`max(0, −treasuryBalance)`) that `treasuryTurn` owns; writing both would create
 * two sources of truth.
 *
 * No affordability check — a payment may push the payer negative, which is what
 * national debt is. Requiring a surplus would mean a country already in debt could
 * never buy peace, which is most of the countries that would want to.
 */
async function moveIndemnity(db: Db, offer: PeaceOfferDoc): Promise<void> {
  const { payer, amount } = offer.indemnity;
  if (!(amount > 0)) return; // A white peace moves no money at all.

  const recipient: CountryId = payer === offer.fromCountry ? offer.toCountry : offer.fromCountry;
  const preset = await loadWorldPreset(db);
  const credited = convertLocal(payer, recipient, amount, preset);
  const now = new Date();

  // Both non-upserting `updateOne`s below match by countryId. If the recipient
  // has no federalBudget doc (the partial-seed gap ensureFederalBudget exists to
  // close), the debit lands but the credit matches zero documents and the
  // indemnity silently vanishes. Heal both parties first so both writes land.
  await ensureFederalBudget(db, payer, preset);
  await ensureFederalBudget(db, recipient, preset);

  const budgets = db.collection<FederalBudget>("federalBudget");
  await budgets.updateOne(
    { countryId: payer },
    { $inc: { treasuryBalance: -amount }, $set: { updatedAt: now } }
  );
  await budgets.updateOne(
    { countryId: recipient },
    { $inc: { treasuryBalance: credited }, $set: { updatedAt: now } }
  );
}
