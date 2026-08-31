/**
 * Every place a party is referenced by its per-country `sequentialId`.
 *
 * Enumerated EMPIRICALLY against the live world, not derived from the type
 * definitions. A type-level sweep is wrong in both directions: several
 * `partyId` fields hold ObjectIds, and several sequentialId fields are typed
 * only as `string`. This is the table a party migration walks, and a new
 * party-referencing collection has exactly one place to be registered.
 *
 * Spec: docs/superpowers/specs/2026-08-29-reunification-merge-design.md
 */
export interface PartyRef {
  collection: string;
  field: string;
}

/** Collections whose party field holds `String(sequentialId)`. */
export const PARTY_REF_COLLECTIONS: PartyRef[] = [
  { collection: "billWhips", field: "partyId" },
  { collection: "bills", field: "sponsorParty" },
  { collection: "cabinetMembers", field: "party" },
  { collection: "caucusChairElections", field: "partyId" },
  { collection: "caucusMemberships", field: "partyId" },
  { collection: "caucuses", field: "partyId" },
  { collection: "characters", field: "party" },
  { collection: "countryHistory", field: "party" },
  { collection: "electedOfficials", field: "party" },
  { collection: "electionCandidates", field: "party" },
  { collection: "nationalCommitteeCandidates", field: "partyId" },
  { collection: "nationalCommitteeElections", field: "partyId" },
  { collection: "nationalPartyCandidates", field: "partyId" },
  { collection: "nationalPartyElections", field: "partyId" },
  { collection: "npps", field: "party" },
  { collection: "orgRegLedger", field: "partyId" },
  { collection: "partyBudget", field: "partyId" },
  { collection: "partyDiscussionPosts", field: "partyId" },
  { collection: "partyGroupFavorability", field: "partyId" },
  { collection: "partyPoliticalStrengthLedger", field: "partyId" },
  { collection: "partyStrengthPressure", field: "partyId" },
  { collection: "recruitmentSlates", field: "partyId" },
  { collection: "slateCandidates", field: "partyId" },
  { collection: "stateBills", field: "sponsorParty" },
  { collection: "statePartyCandidates", field: "partyId" },
  { collection: "statePartyElections", field: "partyId" },
  { collection: "statePartyOrg", field: "partyId" },
  { collection: "treasuryTransactions", field: "partyId" },
];

/**
 * The ONE collection that stores a party's ObjectId rather than its
 * sequentialId. Kept separate because it is remapped by a different key, and
 * folding it into the table above would silently no-op.
 */
export const PARTY_OBJECTID_COLLECTIONS: PartyRef[] = [
  { collection: "committeeProposals", field: "partyId" },
];

/**
 * Values that occupy a party field but are not parties.
 *
 * `__pool__` is `orgRegLedger`'s unallocated-registration bucket; remapping it
 * would invent a party that owns every unclaimed registration. `""` is how
 * `npps` marks an unaffiliated politician, and `independent` is the same idea
 * everywhere else.
 */
export const NON_PARTY_SENTINELS: ReadonlySet<string> = new Set(["__pool__", "independent", ""]);

/** `String(oldSequentialId)` to `String(newSequentialId)`, the shape every remap reads. */
export function buildPartyIdMap(
  moved: Array<{ oldSequentialId: number; newSequentialId: number }>
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const { oldSequentialId, newSequentialId } of moved) {
    map[String(oldSequentialId)] = String(newSequentialId);
  }
  return map;
}
