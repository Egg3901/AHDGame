import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type {
  Character,
  Election,
  ElectionCandidate,
  NPP,
  StatePartyOrg,
  StatePartyCandidate,
  StatePartyElection,
  NationalPartyCandidate,
  NationalPartyElection,
  NationalCommitteeCandidate,
  NationalCommitteeElection,
  PoliticalParty,
} from "@/lib/db/types";
import { removeWithdrawnCandidateFromTally } from "@/lib/electionEngine/tallyCleaner";
import { withdrawFromPartyLeadershipElections } from "@/lib/elections/withdrawFromPartyLeadershipElections";
import { withdrawPlayerEndorsementsOnPartyChange } from "@/lib/elections/playerEndorsements";
import { vacateCongressLeadershipRole } from "@/lib/congress/leadershipElections";
import type { CongressLeader } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

/**
 * When a character switches parties, withdraw them from any active primaries
 * where they were registered under a different party.
 *
 * This prevents the exploit where someone enters a primary as Party A,
 * then switches to Party B, but still wins Party A's primary.
 */
export async function withdrawFromMismatchedPrimaries(
  characterId: ObjectId,
  newParty: string
): Promise<{ withdrawnCount: number; elections: string[] }> {
  const db = await getDb();
  const now = new Date();

  // Find all active candidacies for this character where party doesn't match
  const candidacies = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({
      characterId,
      status: "active",
      party: { $ne: newParty }, // Party doesn't match new party
    })
    .toArray();

  if (candidacies.length === 0) {
    return { withdrawnCount: 0, elections: [] };
  }

  // Get the elections to check if they're still active
  const electionIds = candidacies.map((c) => c.electionId);
  const elections = await db
    .collection<Election>("elections")
    .find({
      _id: { $in: electionIds },
      status: { $in: ["upcoming", "active", "completed"] },
    })
    .toArray();

  const activeElectionIds = new Set(elections.map((e) => e._id.toString()));

  // Filter to only candidacies in active elections
  const toWithdraw = candidacies.filter((c) => activeElectionIds.has(c.electionId.toString()));

  if (toWithdraw.length === 0) {
    return { withdrawnCount: 0, elections: [] };
  }

  // Withdraw the candidacies
  const candidateIds = toWithdraw.map((c) => c._id);
  await db
    .collection("electionCandidates")
    .updateMany(
      { _id: { $in: candidateIds } },
      { $set: { status: "withdrawn", withdrawnAt: now } }
    );

  // Clean up tallies for withdrawn candidates
  for (const c of toWithdraw) {
    await removeWithdrawnCandidateFromTally(db, c.electionId, c._id.toString());
  }

  // Get election details for logging
  const withdrawnElectionDetails = toWithdraw.map((c) => {
    const election = elections.find((e) => e._id.toString() === c.electionId.toString());
    return `${election?.electionType || "unknown"} (${election?.state || "??"}) - was ${c.party}`;
  });

  return {
    withdrawnCount: toWithdraw.length,
    elections: withdrawnElectionDetails,
  };
}

/**
 * Similar function for NPPs when they switch parties
 */
export async function withdrawNPPFromMismatchedPrimaries(
  nppId: ObjectId,
  newParty: string
): Promise<{ withdrawnCount: number; elections: string[] }> {
  const db = await getDb();
  const now = new Date();

  // Find all active candidacies for this NPP where party doesn't match
  const candidacies = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({
      nppId,
      isNPP: true,
      status: "active",
      party: { $ne: newParty },
    })
    .toArray();

  if (candidacies.length === 0) {
    return { withdrawnCount: 0, elections: [] };
  }

  // Get the elections to check if they're still active
  const electionIds = candidacies.map((c) => c.electionId);
  const elections = await db
    .collection<Election>("elections")
    .find({
      _id: { $in: electionIds },
      status: { $in: ["upcoming", "active", "completed"] },
    })
    .toArray();

  const activeElectionIds = new Set(elections.map((e) => e._id.toString()));
  const toWithdraw = candidacies.filter((c) => activeElectionIds.has(c.electionId.toString()));

  if (toWithdraw.length === 0) {
    return { withdrawnCount: 0, elections: [] };
  }

  const candidateIds = toWithdraw.map((c) => c._id);
  await db
    .collection("electionCandidates")
    .updateMany(
      { _id: { $in: candidateIds } },
      { $set: { status: "withdrawn", withdrawnAt: now } }
    );

  // Clean up tallies for withdrawn candidates
  for (const c of toWithdraw) {
    await removeWithdrawnCandidateFromTally(db, c.electionId, c._id.toString());
  }

  const withdrawnElectionDetails = toWithdraw.map((c) => {
    const election = elections.find((e) => e._id.toString() === c.electionId.toString());
    return `${election?.electionType || "unknown"} (${election?.state || "??"}) - was ${c.party}`;
  });

  return {
    withdrawnCount: toWithdraw.length,
    elections: withdrawnElectionDetails,
  };
}

/**
 * When a character switches parties, clean up all party-specific positions and candidacies.
 * This includes:
 * - National party leadership positions (chairId, viceChairId, treasurerId in politicalParties)
 * - State party leadership positions (chairId, viceChairId, treasurerId in statePartyOrg)
 * - State party election candidacies (statePartyCandidates)
 * - National party election candidacies (nationalPartyCandidates)
 * - National committee election candidacies (nationalCommitteeCandidates)
 *
 * @param oldParty - The sequential ID of the party being left (as a string, e.g., "1")
 * @param countryId - The country of the party (required for national party lookup)
 */
export async function cleanupPartyPositionsOnSwitch(
  characterId: ObjectId,
  oldParty: string,
  newParty: string,
  countryId?: CountryId
): Promise<{
  clearedNationalLeadership: string[];
  clearedStateLeadership: string[];
  removedFromCommittee: boolean;
  withdrawnStateElections: number;
  withdrawnNationalElections: number;
  withdrawnCommitteeElections: number;
  withdrawnEndorsements: number;
}> {
  if (oldParty === newParty || oldParty === "independent") {
    return {
      clearedNationalLeadership: [],
      clearedStateLeadership: [],
      removedFromCommittee: false,
      withdrawnStateElections: 0,
      withdrawnNationalElections: 0,
      withdrawnCommitteeElections: 0,
      withdrawnEndorsements: 0,
    };
  }

  const db = await getDb();
  const now = new Date();
  const charIdStr = characterId.toString();
  const clearedNationalLeadership: string[] = [];
  const clearedStateLeadership: string[] = [];
  let removedFromCommittee = false;

  // 1. Clear national party leadership positions and committee membership
  const oldPartySequentialId = parseInt(oldParty, 10);
  const nationalPartyQuery: Record<string, unknown> = {
    sequentialId: oldPartySequentialId,
  };
  if (countryId) {
    nationalPartyQuery.countryId = countryId;
  }

  const nationalParty = await db
    .collection<PoliticalParty>("politicalParties")
    .findOne(nationalPartyQuery);

  if (nationalParty) {
    const setUpdates: Record<string, unknown> = { updatedAt: now };
    const pullUpdates: Record<string, unknown> = {};

    // Check leadership positions
    if (nationalParty.chairId?.toString() === charIdStr) {
      setUpdates.chairId = null;
      clearedNationalLeadership.push("chair");
    }
    if (nationalParty.viceChairId?.toString() === charIdStr) {
      setUpdates.viceChairId = null;
      clearedNationalLeadership.push("viceChair");
    }
    if (nationalParty.treasurerId?.toString() === charIdStr) {
      setUpdates.treasurerId = null;
      clearedNationalLeadership.push("treasurer");
    }
    // Pull from campaignerIds if present (chair-assigned spend-on-behalf role).
    const isCampaigner = (nationalParty.campaignerIds ?? []).some(
      (id) => id.toString() === charIdStr
    );
    if (isCampaigner) {
      pullUpdates.campaignerIds = characterId;
      clearedNationalLeadership.push("campaigner");
    }

    // Check committee membership
    const isCommitteeMember = nationalParty.committeeIds?.some((id) => id.toString() === charIdStr);
    if (isCommitteeMember) {
      pullUpdates.committeeIds = characterId;
      removedFromCommittee = true;
    }

    // Apply updates if needed
    const hasSetUpdates = Object.keys(setUpdates).length > 1; // More than just updatedAt
    const hasPullUpdates = Object.keys(pullUpdates).length > 0;

    if (hasSetUpdates || hasPullUpdates) {
      const updateOp: Record<string, unknown> = {};
      if (hasSetUpdates || hasPullUpdates) updateOp.$set = setUpdates;
      if (hasPullUpdates) updateOp.$pull = pullUpdates;

      await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne({ _id: nationalParty._id }, updateOp);

      // If chair was cleared, sync any coalition this party leads
      if (clearedNationalLeadership.includes("chair")) {
        await db
          .collection("coalitions")
          .updateMany(
            { chairPartyId: nationalParty._id },
            { $set: { chairCharacterId: null, updatedAt: now } }
          );
      }
    }
  }

  // 2. Clear state party leadership positions (incl. campaigner)
  const stateOrgs = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({
      partyId: oldParty,
      $or: [
        { chairId: characterId },
        { viceChairId: characterId },
        { treasurerId: characterId },
        { campaignerId: characterId },
      ],
    })
    .toArray();

  for (const org of stateOrgs) {
    const updates: Record<string, unknown> = { updatedAt: now };
    const positions: string[] = [];

    if (org.chairId?.toString() === charIdStr) {
      updates.chairId = null;
      positions.push("chair");
    }
    if (org.viceChairId?.toString() === charIdStr) {
      updates.viceChairId = null;
      positions.push("viceChair");
    }
    if (org.treasurerId?.toString() === charIdStr) {
      updates.treasurerId = null;
      positions.push("treasurer");
    }
    if (org.campaignerId?.toString() === charIdStr) {
      updates.campaignerId = null;
      positions.push("campaigner");
    }

    if (positions.length > 0) {
      await db
        .collection<StatePartyOrg>("statePartyOrg")
        .updateOne({ _id: org._id }, { $set: updates });
      clearedStateLeadership.push(`${org.stateId}: ${positions.join(", ")}`);
    }
  }

  // 3. Withdraw from active state party election candidacies for old party
  const activeStateElections = await db
    .collection<StatePartyElection>("statePartyElections")
    .find({ partyId: oldParty, status: "voting" })
    .toArray();

  let withdrawnStateElections = 0;
  if (activeStateElections.length > 0) {
    const stateElectionIds = activeStateElections.map((e) => e._id);
    const result = await db.collection<StatePartyCandidate>("statePartyCandidates").updateMany(
      {
        electionId: { $in: stateElectionIds },
        characterId,
        status: "active",
      },
      { $set: { status: "withdrawn", withdrawnAt: now } }
    );
    withdrawnStateElections = result.modifiedCount;
  }

  // 4. Withdraw from the old party's national leadership election candidacies
  // AND delete the leaver's ballots — including ballots cast FOR them — so a
  // departed member no longer stands for, or tallies toward, a seat in a party
  // they left. Shared with the charter/faction split paths (#0701).
  const { candidatesWithdrawn: withdrawnNationalElections } =
    await withdrawFromPartyLeadershipElections(db, [characterId], oldParty, countryId);

  // 5. Withdraw from active national committee election candidacies for old party
  // Filter by countryId to avoid cross-country sequential ID collisions
  const committeeElectionQuery: Record<string, unknown> = { partyId: oldParty, status: "voting" };
  if (countryId) committeeElectionQuery.countryId = countryId;
  const activeCommitteeElections = await db
    .collection<NationalCommitteeElection>("nationalCommitteeElections")
    .find(committeeElectionQuery)
    .toArray();

  let withdrawnCommitteeElections = 0;
  if (activeCommitteeElections.length > 0) {
    const committeeElectionIds = activeCommitteeElections.map((e) => e._id);
    const result = await db
      .collection<NationalCommitteeCandidate>("nationalCommitteeCandidates")
      .updateMany(
        {
          electionId: { $in: committeeElectionIds },
          characterId,
          status: "active",
        },
        { $set: { status: "withdrawn", withdrawnAt: now } }
      );
    withdrawnCommitteeElections = result.modifiedCount;
  }

  // 6. Vacate any congressional leadership roles (SML, Speaker, whips, PPT) this character holds.
  // These positions are party-affiliated; leaving/being purged from a party ends eligibility.
  const heldLeadershipRoles = await db
    .collection<CongressLeader>("congressLeaders")
    .find({ characterId })
    .toArray();
  await Promise.all(
    heldLeadershipRoles.map((doc) => vacateCongressLeadershipRole(db, doc.role, now))
  );

  // Vacating alone left the chair empty until an admin noticed — the Speaker has
  // refilled itself since `vacateSpeakerIfLostSeat`, but Pro Tempore and the
  // Majority Leader/Whip seats had no equivalent. Open their 24-turn race here,
  // at the vacancy transition. Lazy import keeps the congress leadership module
  // (and the two chamber compositions it reads) out of every party switch that
  // touches no leadership at all.
  if (heldLeadershipRoles.length > 0) {
    try {
      const { openElectionsForVacatedMajorityRoles, buildContextsForRoles } =
        await import("@/lib/congress/leadership/reconcilePartyEligibility");
      // Names come from the docs read BEFORE the vacate above, so the feed
      // notice can still say who left rather than "Vacant".
      const vacatedRoles = heldLeadershipRoles.map((doc) => ({
        leaderRole: doc.role,
        formerHolderName: doc.characterName,
      }));
      const contexts = await buildContextsForRoles(db, vacatedRoles);
      await openElectionsForVacatedMajorityRoles(db, vacatedRoles, contexts, now);
    } catch (err) {
      // A failure to open the follow-up election must not roll back the party
      // switch itself, which has already been applied by the caller.
      console.error(
        JSON.stringify({
          error: "leadership_election_open_failed",
          operation: "cleanup_party_positions_on_switch",
          characterId: characterId.toString(),
          details: err instanceof Error ? err.message : "Unknown error",
        })
      );
    }
  }

  // 7. Withdraw player endorsements that now violate primary-phase party
  // alignment (ticket #1179). A member who endorsed their party's presidential
  // candidate must not keep boosting it — standings count and per-turn
  // campaign-action grant included — after defecting to another party or to
  // independence. Cross-party endorsements stay untouched in general-phase
  // races, where they are legal.
  const withdrawnEndorsements = await withdrawPlayerEndorsementsOnPartyChange(
    db,
    characterId,
    newParty,
    { now }
  );

  return {
    clearedNationalLeadership,
    clearedStateLeadership,
    removedFromCommittee,
    withdrawnStateElections,
    withdrawnNationalElections,
    withdrawnCommitteeElections,
    withdrawnEndorsements,
  };
}

/**
 * Turn-phase sweep: withdraw any active election candidate whose current party
 * no longer matches the party on their candidacy record.
 *
 * Handles both player characters and NPPs. Only touches elections that are
 * still "upcoming", "active", or "completed" (awaiting resolution).
 *
 * Does NOT withdraw a candidate who has a separate active candidacy under
 * their current party in the same election — only the stale-party entry is removed.
 */
export async function sweepPartyMismatchedCandidates(): Promise<number> {
  const db = await getDb();
  const now = new Date();

  // Get all active candidacies in non-resolved elections
  const activeElections = await db
    .collection<Election>("elections")
    .find({ status: { $in: ["upcoming", "active", "completed"] } })
    .project({ _id: 1 })
    .toArray();

  if (activeElections.length === 0) return 0;

  const activeElectionIds = activeElections.map((e) => e._id);

  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({
      electionId: { $in: activeElectionIds },
      status: "active",
    })
    .toArray();

  if (candidates.length === 0) return 0;

  // Collect all character and NPP IDs referenced by candidacies
  const charIds = [
    ...new Set(candidates.filter((c) => c.characterId).map((c) => c.characterId!.toString())),
  ].map((id) => new ObjectId(id));
  const nppIds = [
    ...new Set(candidates.filter((c) => c.nppId && c.isNPP).map((c) => c.nppId!.toString())),
  ].map((id) => new ObjectId(id));

  // Batch-load current party for all referenced characters and NPPs
  const charPartyMap = new Map<string, string>();
  if (charIds.length > 0) {
    const chars = await db
      .collection<Character>("characters")
      .find({ _id: { $in: charIds } })
      .project({ _id: 1, party: 1 })
      .toArray();
    for (const c of chars) {
      charPartyMap.set(c._id.toString(), c.party ?? "independent");
    }
  }

  const nppPartyMap = new Map<string, string>();
  if (nppIds.length > 0) {
    const npps = await db
      .collection<NPP>("npps")
      .find({ _id: { $in: nppIds } })
      .project({ _id: 1, party: 1 })
      .toArray();
    for (const n of npps) {
      nppPartyMap.set(n._id.toString(), n.party ?? "independent");
    }
  }

  // Identify mismatched candidacies
  const toWithdraw: ElectionCandidate[] = [];
  for (const cand of candidates) {
    const currentParty = cand.characterId
      ? charPartyMap.get(cand.characterId.toString())
      : cand.nppId
        ? nppPartyMap.get(cand.nppId.toString())
        : undefined;

    if (currentParty === undefined) continue; // Entity not found — skip
    if (cand.party === currentParty) continue; // Party still matches — OK

    // Check that the entity doesn't already have a CORRECT candidacy in this election
    // (prevents withdrawing someone's old entry when they already re-entered under new party)
    const _hasCorrectEntry = candidates.some(
      (other) =>
        other._id.toString() !== cand._id.toString() &&
        other.electionId.toString() === cand.electionId.toString() &&
        other.status === "active" &&
        other.party === currentParty &&
        ((cand.characterId && other.characterId?.toString() === cand.characterId.toString()) ||
          (cand.nppId && other.nppId?.toString() === cand.nppId.toString()))
    );

    // Withdraw the stale-party candidacy regardless — their current party doesn't match
    toWithdraw.push(cand);
  }

  if (toWithdraw.length === 0) return 0;

  // Withdraw all mismatched candidacies
  const ids = toWithdraw.map((c) => c._id);
  await db
    .collection("electionCandidates")
    .updateMany({ _id: { $in: ids } }, { $set: { status: "withdrawn", withdrawnAt: now } });

  // Clean tallies
  for (const c of toWithdraw) {
    await removeWithdrawnCandidateFromTally(db, c.electionId, c._id.toString());
  }

  if (toWithdraw.length > 0) {
    console.log(
      `[Turn] sweepPartyMismatchedCandidates: withdrew ${toWithdraw.length} stale-party candidacies`
    );
  }

  return toWithdraw.length;
}

/**
 * Withdraws a character from every active candidacy that still matters:
 *   - electionCandidates (general/primary) — where the parent election is upcoming/active/completed
 *   - statePartyCandidates                — where the parent election status is "voting"
 *   - nationalPartyCandidates             — where the parent election status is "voting"
 *   - nationalCommitteeCandidates         — where the parent election status is "voting"
 *
 * Parent-election tallies are cleaned for general-election candidacies. Used on
 * relocation: relocation auto-withdraws rather than blocks.
 */
export async function withdrawAllActiveCandidacies(characterId: ObjectId): Promise<{
  withdrawnGeneralElections: number;
  withdrawnStatePartyElections: number;
  withdrawnNationalPartyElections: number;
  withdrawnCommitteeElections: number;
}> {
  const db = await getDb();
  const now = new Date();

  // 1. General / primary election candidacies
  const generalCandidacies = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ characterId, status: "active" })
    .toArray();

  let withdrawnGeneralElections = 0;
  if (generalCandidacies.length > 0) {
    const electionIds = [...new Set(generalCandidacies.map((c) => c.electionId))];
    const openElections = await db
      .collection<Election>("elections")
      .find({
        _id: { $in: electionIds },
        status: { $in: ["upcoming", "active", "completed"] },
      })
      .project({ _id: 1 })
      .toArray();
    const openIds = new Set(openElections.map((e) => e._id.toString()));
    const toWithdraw = generalCandidacies.filter((c) => openIds.has(c.electionId.toString()));

    if (toWithdraw.length > 0) {
      const ids = toWithdraw.map((c) => c._id);
      await db
        .collection("electionCandidates")
        .updateMany({ _id: { $in: ids } }, { $set: { status: "withdrawn", withdrawnAt: now } });
      for (const c of toWithdraw) {
        await removeWithdrawnCandidateFromTally(db, c.electionId, c._id.toString());
      }
      withdrawnGeneralElections = toWithdraw.length;
    }
  }

  // 2. State-party election candidacies (voting)
  const activeStateElections = await db
    .collection<StatePartyElection>("statePartyElections")
    .find({ status: "voting" })
    .project({ _id: 1 })
    .toArray();

  let withdrawnStatePartyElections = 0;
  if (activeStateElections.length > 0) {
    const stateElectionIds = activeStateElections.map((e) => e._id);
    const result = await db.collection<StatePartyCandidate>("statePartyCandidates").updateMany(
      {
        electionId: { $in: stateElectionIds },
        characterId,
        status: "active",
      },
      { $set: { status: "withdrawn", withdrawnAt: now } }
    );
    withdrawnStatePartyElections = result.modifiedCount;
  }

  // 3. National-party election candidacies (voting)
  const activeNationalElections = await db
    .collection<NationalPartyElection>("nationalPartyElections")
    .find({ status: "voting" })
    .project({ _id: 1 })
    .toArray();

  let withdrawnNationalPartyElections = 0;
  if (activeNationalElections.length > 0) {
    const nationalElectionIds = activeNationalElections.map((e) => e._id);
    const result = await db
      .collection<NationalPartyCandidate>("nationalPartyCandidates")
      .updateMany(
        {
          electionId: { $in: nationalElectionIds },
          characterId,
          status: "active",
        },
        { $set: { status: "withdrawn", withdrawnAt: now } }
      );
    withdrawnNationalPartyElections = result.modifiedCount;
  }

  // 4. National-committee election candidacies (voting)
  const activeCommitteeElections = await db
    .collection<NationalCommitteeElection>("nationalCommitteeElections")
    .find({ status: "voting" })
    .project({ _id: 1 })
    .toArray();

  let withdrawnCommitteeElections = 0;
  if (activeCommitteeElections.length > 0) {
    const committeeElectionIds = activeCommitteeElections.map((e) => e._id);
    const result = await db
      .collection<NationalCommitteeCandidate>("nationalCommitteeCandidates")
      .updateMany(
        {
          electionId: { $in: committeeElectionIds },
          characterId,
          status: "active",
        },
        { $set: { status: "withdrawn", withdrawnAt: now } }
      );
    withdrawnCommitteeElections = result.modifiedCount;
  }

  return {
    withdrawnGeneralElections,
    withdrawnStatePartyElections,
    withdrawnNationalPartyElections,
    withdrawnCommitteeElections,
  };
}
