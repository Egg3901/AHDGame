/** New world collections need a bootstrap index plan or a reviewed primary-key policy. */
export const PRIMARY_KEY_INDEX_POLICIES: Readonly<Record<string, string>> = {
  fundWritedownCompensationLedger: "Retired world receipts have no active secondary access path.",
  procurementRestrictions: "One restriction per country, read and updated by its country _id.",
  vietnamEscalation: "One singleton, read and upserted by _id.",
  appliedWorldTransitions:
    "One receipt per authored rule, upserted by _id; the bounded rule roster is read once.",
  bankingTelemetry: "Turn number is the _id used for upsert and latest-turn ordering.",
  acquisitionSettlements: "Settlement recovery and writes address the offer identity through _id.",
  ngChamberLeadershipElections: "One election per chamber role, read and written by _id.",
  nppOperatorDiagnostics:
    "Turn number is _id; only the bounded 48-turn retention scan uses another key.",
  capacityDecisionFunnels:
    "Turn number is _id; only the bounded 48-turn retention scan uses another key.",
  contestRounds:
    "Round id is kind:roundNumber. About four rounds a week, wiped on reset, so status scans stay tiny.",
};

export function missingCollectionIndexPolicies(
  entries: readonly { name: string; category: string }[],
  plannedCollections: ReadonlySet<string>,
  legacyCollections: ReadonlySet<string>,
  policies: Readonly<Record<string, string>> = PRIMARY_KEY_INDEX_POLICIES
): string[] {
  return entries
    .filter(
      (entry) =>
        ["runtime", "reference"].includes(entry.category) &&
        !plannedCollections.has(entry.name) &&
        !legacyCollections.has(entry.name) &&
        !policies[entry.name]?.trim()
    )
    .map((entry) => entry.name)
    .sort();
}
