export type CongressBillStatusFilter = "all" | "active" | "enrolled" | "signed" | "failed";

type CongressBillVote = "for" | "against" | "abstain" | null;

type CongressBillFilterInput = {
  status: string;
  myVote: CongressBillVote;
  myOtherChamberVote: CongressBillVote;
};

const CONGRESS_VOTING_STATUSES = new Set([
  "active",
  "active_other",
  // Both chambers voting at once still reads as "Active" in list views.
  "active_both",
  // JP Shūgiin override is a fresh active vote (uses main votes/votingEndsAt
  // fields) so list views with the "Active" filter need to surface it.
  "override_shugiin",
]);

export function matchesCongressBillStatusFilter(
  status: string,
  filter: CongressBillStatusFilter
): boolean {
  if (filter === "all") return true;
  if (filter === "active") return CONGRESS_VOTING_STATUSES.has(status);
  return status === filter;
}

export function getCurrentCongressBillVote(bill: CongressBillFilterInput): CongressBillVote {
  // On a concurrent bill the viewer sits in exactly one chamber, so whichever of the two
  // votes they actually cast is theirs — prefer the upper one when present rather than
  // reporting "not voted" to every senator.
  if (bill.status === "active_both") return bill.myOtherChamberVote ?? bill.myVote;
  return bill.status === "active_other" ? bill.myOtherChamberVote : bill.myVote;
}
