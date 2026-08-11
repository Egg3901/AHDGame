/**
 * Read models for the consent bill(s) a passed referendum opens during its
 * conversion window — one Westminster bill for independence, plus a concurrent
 * Dáil bill for reunification. Surfaced on the referendum detail page so a
 * voter can see whether Parliament has consented yet and follow the link to the
 * actual bill.
 *
 * The pass/fail derivation mirrors `processReferendumLifecycle` exactly (a bill
 * counts as passed once "signed" / enacted, and failed when missing, "failed",
 * or "withdrawn") so the card never disagrees with the engine that converts.
 */
import { getCountryConfig } from "@/lib/constants/countries";
import type { Bill } from "@/lib/db/types";
import type { ObjectId } from "mongodb";

export type ConsentOutcome = "passed" | "failed" | "pending";

export interface ConsentBillView {
  id: string;
  title: string;
  countryName: string;
  outcome: ConsentOutcome;
  votesFor: number;
  votesAgainst: number;
  href: string;
}

/** Classify a consent bill's standing — identical rules to the lifecycle's
 *  convert/cancel decision. A missing bill is treated as failed (withdrawn). */
export function consentBillOutcome(
  bill: Pick<Bill, "status" | "enactedAt"> | null | undefined
): ConsentOutcome {
  if (bill == null) return "failed";
  if (bill.status === "signed" || bill.enactedAt != null) return "passed";
  if (bill.status === "failed" || bill.status === "withdrawn") return "failed";
  return "pending";
}

/** Build display rows for the ordered consent bill ids, joining each to its
 *  fetched doc. Ids with no doc still render (as failed) so the slot is visible. */
export function buildConsentBillViews(
  orderedBillIds: (ObjectId | string)[],
  billsById: Map<string, Bill>
): ConsentBillView[] {
  return orderedBillIds.map((rawId) => {
    const id = String(rawId);
    const bill = billsById.get(id);
    return {
      id,
      title: bill?.title ?? "Consent bill",
      countryName: bill?.countryId ? getCountryConfig(bill.countryId).name : "—",
      outcome: consentBillOutcome(bill),
      votesFor: bill?.votesFor ?? 0,
      votesAgainst: bill?.votesAgainst ?? 0,
      href: `/congress/bills/${id}`,
    };
  });
}
