/** Revised federation mandates need a new vote after rejection or withdrawal.
 * proposalRevisionConflict prevents replacing an active mandate or reusing a
 * rejected revision, while permitting an identical active request to retry. */
export function proposalRevisionConflict(input: {
  settlementId: string;
  revision: number;
  latest?: { settlementId: string; revision: number; status: string };
}): string | null {
  const { settlementId, revision, latest } = input;
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > 10_000)
    return "Federation revision must be an integer between 1 and 10,000.";
  if (!latest) return revision === 1 ? null : "The first settlement mandate must use revision 1.";
  if (latest.settlementId !== settlementId)
    return "Revisions must retain the existing settlement identity.";
  if (latest.revision === revision && latest.status === "open") return null;
  if (!["rejected", "withdrawn"].includes(latest.status))
    return "The existing mandate must be rejected or withdrawn before opening revised terms.";
  return revision === latest.revision + 1 ? null : "Use the next revision for a new mandate vote.";
}
