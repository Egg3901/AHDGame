// src/lib/turn/partyOrg/emptyPartyCleanup.ts
import { getDb } from "@/lib/mongodb";
import type {
  PoliticalParty,
  StatePartyOrg,
  PartyBudget,
  StatePartyElection,
  StatePartyCandidate,
  StatePartyVote,
  NationalPartyElection,
  NationalPartyCandidate,
  NationalPartyVote,
  NationalCommitteeElection,
  NationalCommitteeCandidate,
  NationalCommitteeVote,
  BillWhip,
  Character,
  NPP,
  ElectedOfficial,
  Caucus,
  CaucusMembership,
  CaucusPolicyPosition,
  RecruitmentSlate,
  SlateCandidate,
  TreasuryTransaction,
  PartyCharter,
} from "@/lib/db/types";
import type { Coalition } from "@/lib/db/types/coalition";

export interface EmptyPartyCleanupResult {
  deletedParties: string[];
  deletedStatePartyOrgs: number;
  deletedPartyBudgets: number;
  deletedStateElections: number;
  deletedStateCandidates: number;
  deletedStateVotes: number;
  deletedNationalElections: number;
  deletedNationalCandidates: number;
  deletedNationalVotes: number;
  deletedCommitteeElections: number;
  deletedCommitteeCandidates: number;
  deletedCommitteeVotes: number;
  deletedBillWhips: number;
}

/**
 * Cleanup empty parties (memberCount = 0) that are not default parties.
 * Deletes the party and all associated data:
 * - State party organizations
 * - Party budgets
 * - State/National/Committee party elections and their candidates/votes
 * - Bill whip positions
 *
 * @returns Summary of deleted records
 */
export async function cleanupEmptyParties(): Promise<EmptyPartyCleanupResult> {
  const db = await getDb();

  // Find non-default parties (we'll check actual membership, not the memberCount field)
  const nonDefaultParties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ isDefault: { $ne: true } })
    .toArray();

  if (nonDefaultParties.length === 0) {
    return {
      deletedParties: [],
      deletedStatePartyOrgs: 0,
      deletedPartyBudgets: 0,
      deletedStateElections: 0,
      deletedStateCandidates: 0,
      deletedStateVotes: 0,
      deletedNationalElections: 0,
      deletedNationalCandidates: 0,
      deletedNationalVotes: 0,
      deletedCommitteeElections: 0,
      deletedCommitteeCandidates: 0,
      deletedCommitteeVotes: 0,
      deletedBillWhips: 0,
    };
  }

  const partyStringIds = nonDefaultParties.map((p) => String(p.sequentialId));

  // Count actual members (characters + active NPPs) and elected officials for each party
  // Use composite keys (countryId:partyId) to avoid cross-country sequential ID collisions
  type CompositeCount = { _id: { countryId: string; party: string }; count: number };
  const [charCounts, nppCounts, officialCounts] = await Promise.all([
    db
      .collection<Character>("characters")
      .aggregate<CompositeCount>([
        { $match: { party: { $in: partyStringIds } } },
        {
          $group: {
            _id: { countryId: { $ifNull: ["$countryId", "US"] }, party: "$party" },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray(),
    db
      .collection<NPP>("npps")
      .aggregate<CompositeCount>([
        { $match: { party: { $in: partyStringIds }, retiredAt: null } },
        {
          $group: {
            _id: { countryId: { $ifNull: ["$countryId", "US"] }, party: "$party" },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray(),
    // Also check for elected officials - don't delete parties with sitting members of Congress/Parliament
    // Note: ElectedOfficial doesn't have countryId, but the party field is specific to a country
    // For now, we count all officials with matching party (sequential ID)
    db
      .collection<ElectedOfficial>("electedOfficials")
      .aggregate<{ _id: string; count: number }>([
        {
          $match: {
            party: { $in: partyStringIds },
            $or: [{ characterId: { $ne: null } }, { nppId: { $ne: null } }],
          },
        },
        { $group: { _id: "$party", count: { $sum: 1 } } },
      ])
      .toArray(),
  ]);

  // Build composite key maps: "countryId:partyId" -> count
  const charCountMap = new Map(
    charCounts.map((r) => [`${r._id.countryId}:${r._id.party}`, r.count])
  );
  const nppCountMap = new Map(nppCounts.map((r) => [`${r._id.countryId}:${r._id.party}`, r.count]));
  // Officials map uses simple party key since ElectedOfficial lacks countryId
  const officialCountMap = new Map(officialCounts.map((r) => [r._id, r.count]));

  // Phase 6 cleanup-immunity: a non-default party that has a chartered
  // status (`ratified` / `migrated` / `migrated-incomplete`) is exempt
  // from emptyPartyCleanup even if temporarily empty. The charter is the
  // founding agreement — losing it requires an explicit dissolution flow.
  const charteredPartyIds = new Set<string>(
    (
      await db
        .collection<PartyCharter>("partyCharters")
        .find({
          status: { $in: ["ratified", "migrated", "migrated-incomplete"] },
          partyId: { $ne: null },
        })
        .project<{ partyId: string; countryId: string }>({ partyId: 1, countryId: 1 })
        .toArray()
    ).map((c) => `${c.countryId}:${c.partyId}`)
  );

  // Find parties with 0 actual members AND 0 elected officials AND not chartered
  const emptyParties = nonDefaultParties.filter((p) => {
    const compositeKey = `${p.countryId ?? "US"}:${p.sequentialId}`;
    const partyStringId = String(p.sequentialId);
    if (charteredPartyIds.has(compositeKey)) return false;
    const charCount = charCountMap.get(compositeKey) ?? 0;
    const nppCount = nppCountMap.get(compositeKey) ?? 0;
    // For officials, use simple key since ElectedOfficial doesn't have countryId
    const officialCount = officialCountMap.get(partyStringId) ?? 0;
    return charCount + nppCount + officialCount === 0;
  });

  if (emptyParties.length === 0) {
    return {
      deletedParties: [],
      deletedStatePartyOrgs: 0,
      deletedPartyBudgets: 0,
      deletedStateElections: 0,
      deletedStateCandidates: 0,
      deletedStateVotes: 0,
      deletedNationalElections: 0,
      deletedNationalCandidates: 0,
      deletedNationalVotes: 0,
      deletedCommitteeElections: 0,
      deletedCommitteeCandidates: 0,
      deletedCommitteeVotes: 0,
      deletedBillWhips: 0,
    };
  }

  const partyIds = emptyParties.map((p) => p._id);
  const partySeqIds = emptyParties.map((p) => String(p.sequentialId));
  // Build (countryId, partyId) pairs to avoid cross-country sequential ID collisions
  const partyCountryPairs = emptyParties.map((p) => ({
    countryId: p.countryId ?? "US",
    partyId: String(p.sequentialId),
  }));
  console.log(
    `[EmptyPartyCleanup] Found ${partySeqIds.length} empty parties to delete: ${partySeqIds.join(", ")}`
  );

  // 1. Get election IDs before deleting (needed for candidate/vote cleanup)
  // StatePartyElection doesn't have countryId — resolve state IDs per country
  const uniqueCountries = [...new Set(partyCountryPairs.map((p) => p.countryId))];
  const stateIdsByCountry = new Map<string, string[]>();
  for (const cid of uniqueCountries) {
    const states = await db
      .collection("states")
      .find({ countryId: cid })
      .project({ _id: 1 })
      .toArray();
    stateIdsByCountry.set(
      cid,
      states.map((s) => s._id as string)
    );
  }
  const stateElectionFilters = partyCountryPairs.map(({ countryId, partyId }) => {
    const stateIds = stateIdsByCountry.get(countryId) ?? [];
    return { partyId, stateId: { $in: stateIds } };
  });

  const stateElections =
    stateElectionFilters.length > 0
      ? await db
          .collection<StatePartyElection>("statePartyElections")
          .find({ $or: stateElectionFilters })
          .toArray()
      : [];
  const stateElectionIds = stateElections.map((e) => e._id);

  const nationalElections =
    partyCountryPairs.length > 0
      ? await db
          .collection<NationalPartyElection>("nationalPartyElections")
          .find({ $or: partyCountryPairs })
          .toArray()
      : [];
  const nationalElectionIds = nationalElections.map((e) => e._id);

  const committeeElections =
    partyCountryPairs.length > 0
      ? await db
          .collection<NationalCommitteeElection>("nationalCommitteeElections")
          .find({ $or: partyCountryPairs })
          .toArray()
      : [];
  const committeeElectionIds = committeeElections.map((e) => e._id);
  const caucuses =
    partyCountryPairs.length > 0
      ? await db.collection<Caucus>("caucuses").find({ $or: partyCountryPairs }).toArray()
      : [];
  const caucusIds = caucuses.map((caucus) => caucus._id);

  // 2. Delete candidates and votes for all elections
  let deletedStateCandidates = 0;
  let deletedStateVotes = 0;
  if (stateElectionIds.length > 0) {
    const candidateResult = await db
      .collection<StatePartyCandidate>("statePartyCandidates")
      .deleteMany({ electionId: { $in: stateElectionIds } });
    deletedStateCandidates = candidateResult.deletedCount;

    const voteResult = await db
      .collection<StatePartyVote>("statePartyVotes")
      .deleteMany({ electionId: { $in: stateElectionIds } });
    deletedStateVotes = voteResult.deletedCount;
  }

  let deletedNationalCandidates = 0;
  let deletedNationalVotes = 0;
  if (nationalElectionIds.length > 0) {
    const candidateResult = await db
      .collection<NationalPartyCandidate>("nationalPartyCandidates")
      .deleteMany({ electionId: { $in: nationalElectionIds } });
    deletedNationalCandidates = candidateResult.deletedCount;

    const voteResult = await db
      .collection<NationalPartyVote>("nationalPartyVotes")
      .deleteMany({ electionId: { $in: nationalElectionIds } });
    deletedNationalVotes = voteResult.deletedCount;
  }

  let deletedCommitteeCandidates = 0;
  let deletedCommitteeVotes = 0;
  if (committeeElectionIds.length > 0) {
    const candidateResult = await db
      .collection<NationalCommitteeCandidate>("nationalCommitteeCandidates")
      .deleteMany({ electionId: { $in: committeeElectionIds } });
    deletedCommitteeCandidates = candidateResult.deletedCount;

    const voteResult = await db
      .collection<NationalCommitteeVote>("nationalCommitteeVotes")
      .deleteMany({ electionId: { $in: committeeElectionIds } });
    deletedCommitteeVotes = voteResult.deletedCount;
  }

  // 3. Delete elections
  // Use $or with (countryId, partyId) pairs for national/committee to avoid cross-country collisions
  // StatePartyElection uses stateId prefix filtering (same as query above)
  const stateElectionResult =
    stateElectionFilters.length > 0
      ? await db
          .collection<StatePartyElection>("statePartyElections")
          .deleteMany({ $or: stateElectionFilters })
      : { deletedCount: 0 };

  const nationalElectionResult =
    partyCountryPairs.length > 0
      ? await db
          .collection<NationalPartyElection>("nationalPartyElections")
          .deleteMany({ $or: partyCountryPairs })
      : { deletedCount: 0 };

  const committeeElectionResult =
    partyCountryPairs.length > 0
      ? await db
          .collection<NationalCommitteeElection>("nationalCommitteeElections")
          .deleteMany({ $or: partyCountryPairs })
      : { deletedCount: 0 };

  // 4. Delete state party organizations (has countryId field)
  const stateOrgResult =
    partyCountryPairs.length > 0
      ? await db.collection<StatePartyOrg>("statePartyOrg").deleteMany({ $or: partyCountryPairs })
      : { deletedCount: 0 };

  // 5. Delete party budgets (has countryId field)
  const budgetResult =
    partyCountryPairs.length > 0
      ? await db.collection<PartyBudget>("partyBudget").deleteMany({ $or: partyCountryPairs })
      : { deletedCount: 0 };

  // 6. Delete bill whips
  // BillWhip has countryId field — use it directly for filtering
  const whipFilters = partyCountryPairs.flatMap(({ countryId, partyId }) => {
    const stateFilter = { partyId, countryId, stateId: { $exists: true } };
    const nationalFilter = { partyId, countryId, stateId: { $exists: false } };
    return [stateFilter, nationalFilter];
  });
  const whipResult =
    whipFilters.length > 0
      ? await db.collection<BillWhip>("billWhips").deleteMany({ $or: whipFilters })
      : { deletedCount: 0 };

  // 6b. Delete caucus-owned records before dropping the parent party. Party
  // cleanup runs automatically during turns, so leaving these docs behind would
  // strand active caucus orders/treasury history with no live party surface.
  if (caucusIds.length > 0) {
    await db
      .collection<CaucusMembership>("caucusMemberships")
      .deleteMany({ caucusId: { $in: caucusIds } });
    await db
      .collection<CaucusPolicyPosition>("caucusPolicyPositions")
      .deleteMany({ caucusId: { $in: caucusIds } });
  }
  if (partyCountryPairs.length > 0) {
    await db
      .collection<RecruitmentSlate>("recruitmentSlates")
      .deleteMany({ $or: partyCountryPairs });
    await db.collection<SlateCandidate>("slateCandidates").deleteMany({ $or: partyCountryPairs });
    await db
      .collection<TreasuryTransaction>("treasuryTransactions")
      .deleteMany({ $or: partyCountryPairs });
    await db.collection<Caucus>("caucuses").deleteMany({ $or: partyCountryPairs });
  }

  // 6c. Remove deleted parties from any coalition memberships
  for (const party of emptyParties) {
    const partyOid = party._id;

    const coalition = await db.collection<Coalition>("coalitions").findOne({
      "members.partyId": partyOid,
    });

    if (coalition) {
      const remainingMembers = coalition.members.filter((m) => !m.partyId.equals(partyOid));

      if (remainingMembers.length === 0) {
        // Last member — delete coalition entirely
        await db.collection<Coalition>("coalitions").deleteOne({ _id: coalition._id });
      } else if (coalition.chairPartyId.equals(partyOid)) {
        // Chair's party is being deleted — pass to next most senior member
        const nextMember = [...remainingMembers].sort(
          (a, b) => a.joinedAt.getTime() - b.joinedAt.getTime()
        )[0]!;
        const nextParty = await db
          .collection<PoliticalParty>("politicalParties")
          .findOne({ _id: nextMember.partyId });

        const newChairCharacterId = nextParty?.chairId ?? null;

        await db.collection<Coalition>("coalitions").updateOne(
          { _id: coalition._id },
          {
            $pull: { members: { partyId: partyOid } },
            $set: {
              chairPartyId: nextMember.partyId,
              ...(newChairCharacterId ? { chairCharacterId: newChairCharacterId } : {}),
              updatedAt: new Date(),
            },
          }
        );
      } else {
        // Non-chair member deleted — just remove from members list
        await db.collection<Coalition>("coalitions").updateOne(
          { _id: coalition._id },
          {
            $pull: { members: { partyId: partyOid } },
            $set: { updatedAt: new Date() },
          }
        );
      }
    }
  }

  // 7. Finally, delete the parties themselves
  await db.collection<PoliticalParty>("politicalParties").deleteMany({ _id: { $in: partyIds } });

  const result: EmptyPartyCleanupResult = {
    deletedParties: partySeqIds,
    deletedStatePartyOrgs: stateOrgResult.deletedCount,
    deletedPartyBudgets: budgetResult.deletedCount,
    deletedStateElections: stateElectionResult.deletedCount,
    deletedStateCandidates,
    deletedStateVotes,
    deletedNationalElections: nationalElectionResult.deletedCount,
    deletedNationalCandidates,
    deletedNationalVotes,
    deletedCommitteeElections: committeeElectionResult.deletedCount,
    deletedCommitteeCandidates,
    deletedCommitteeVotes,
    deletedBillWhips: whipResult.deletedCount,
  };

  console.log(
    `[EmptyPartyCleanup] Deleted ${partyIds.length} empty parties and associated data:`,
    result
  );

  return result;
}
