import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getEligibleVoterSet } from "@/lib/parties/proposals";
import type { NationalPartyElection, NationalPartyVote, PoliticalParty } from "@/lib/db/types";
import { type CountryId } from "@/lib/constants/countries";
import { applyOptionalCountryScope } from "./nationalPartyElectionScope";

// ─── Quorum Acceleration ─────────────────────────────────────────────────────

/**
 * Quorum acceleration: when >50% of a party's eligible voters have cast a vote
 * AND the chair seat is vacant, halve the remaining election timer. Eligible
 * voters are player members (NPPs do not vote in leadership elections), or the
 * committee + leadership for committee-method parties — NOT the stored
 * `memberCount`, which also counts NPPs and drifts. This only applies to
 * chair-position elections. Fires at most once per election (tracked by
 * `quorumAcceleratedAtTurn`). Skipped on a party's first chair cycle (no prior
 * completed chair election) so inaugural / post-reset leadership races stay in
 * lockstep with viceChair/treasurer (ticket #1023).
 *
 * Returns the number of elections that were accelerated this turn.
 */
export async function applyQuorumAcceleration(
  currentTurn: number,
  countryId?: CountryId
): Promise<number> {
  const db = await getDb();

  // Find active chair elections that haven't been accelerated yet
  const scopedQuery = applyOptionalCountryScope(
    {
      status: "voting",
      position: "chair",
      quorumAcceleratedAtTurn: { $exists: false },
      // Only consider elections that haven't already ended
      endTurn: { $gt: currentTurn },
    },
    countryId
  );

  const candidateElections = await db
    .collection<NationalPartyElection>("nationalPartyElections")
    .find(scopedQuery)
    .toArray();

  if (candidateElections.length === 0) return 0;

  // Collect unique party keys to fetch party data
  const partyKeys = [
    ...new Set(candidateElections.map((e) => `${e.countryId ?? "US"}:${e.partyId}`)),
  ];
  const partySequentialIds = partyKeys.map((k) => Number.parseInt(k.split(":")[1], 10));
  const partyCountryIds = partyKeys.map((k) => k.split(":")[0] as CountryId);
  const partyIdStrings = partyKeys.map((k) => k.split(":")[1]);

  // First-cycle gate: only accelerate parties that have already finished at
  // least one chair election. Without this, post-reset / inaugural races
  // (often short, vacant-chair, high early turnout) desync chair timers from
  // viceChair/treasurer on day one.
  const priorCompletedQuery = applyOptionalCountryScope(
    {
      status: "completed",
      position: "chair",
      partyId: { $in: partyIdStrings },
    },
    countryId
  );
  const [parties, priorCompletedChairs] = await Promise.all([
    db
      .collection<PoliticalParty>("politicalParties")
      .find({
        sequentialId: { $in: partySequentialIds },
        countryId: { $in: partyCountryIds },
      })
      .toArray(),
    db
      .collection<NationalPartyElection>("nationalPartyElections")
      .find(priorCompletedQuery)
      .toArray(),
  ]);

  const partyMap = new Map(parties.map((p) => [`${p.countryId ?? "US"}:${p.sequentialId}`, p]));
  const partiesWithPriorChairCycle = new Set(
    priorCompletedChairs.map((e) => `${e.countryId ?? "US"}:${e.partyId}`)
  );

  // Eligible-voter denominator per party. NPPs do not vote in leadership
  // elections, so quorum is measured against eligible PLAYER members — not the
  // stored `memberCount`, which also counts NPPs (and drifts). Committee-method
  // parties restrict voting to the committee + national leadership (handled in
  // the loop via getEligibleVoterSet); every other method ("party",
  // "influence") lets each player member vote, so we count them live here.
  const playerPartyIdStrings = parties.map((p) => String(p.sequentialId));
  const playerCountRaw = await db
    .collection("characters")
    .aggregate<{ _id: { party: string; countryId: string }; count: number }>([
      {
        $match: { party: { $in: playerPartyIdStrings }, countryId: { $in: partyCountryIds } },
      },
      { $group: { _id: { party: "$party", countryId: "$countryId" }, count: { $sum: 1 } } },
    ])
    .toArray();
  const playerCountByParty = new Map(
    playerCountRaw.map((r) => [`${r._id.countryId ?? "US"}:${r._id.party}`, r.count])
  );

  // Count distinct voters per chair election
  const electionIds = candidateElections.map((e) => e._id);
  const voteCountsRaw = await db
    .collection<NationalPartyVote>("nationalPartyVotes")
    .aggregate<{
      electionId: ObjectId;
      distinctVoters: number;
    }>([
      { $match: { electionId: { $in: electionIds } } },
      { $group: { _id: "$voterId", electionId: { $first: "$electionId" } } },
      {
        $group: {
          _id: "$electionId",
          distinctVoters: { $sum: 1 },
        },
      },
      {
        $project: {
          electionId: "$_id",
          distinctVoters: 1,
          _id: 0,
        },
      },
    ])
    .toArray();

  const votersByElection = new Map<string, number>();
  for (const v of voteCountsRaw) {
    votersByElection.set(v.electionId.toString(), v.distinctVoters);
  }

  // Determine which elections qualify for acceleration
  const acceleratedIds: ObjectId[] = [];
  const acceleratedUpdates: {
    electionId: ObjectId;
    newEndTurn: number;
    originalEndTurn: number;
  }[] = [];

  for (const election of candidateElections) {
    const partyKey = `${election.countryId ?? "US"}:${election.partyId}`;
    const party = partyMap.get(partyKey);
    if (!party) continue;

    // Skip inaugural chair races — keep the first cycle aligned with the other
    // national offices (ticket #1023).
    if (!partiesWithPriorChairCycle.has(partyKey)) continue;

    // Only accelerate when the chair seat is vacant
    if (party.chairId !== null) continue;

    // Eligible voters who may actually cast a ballot (NPPs cannot). Committee-
    // method elections restrict the electorate to committee + leadership; all
    // other methods enfranchise every player member.
    const eligibleVoterCount =
      party.leadershipElectionMethod === "committee"
        ? getEligibleVoterSet(party).size
        : (playerCountByParty.get(partyKey) ?? 0);
    if (eligibleVoterCount <= 0) continue;

    const voterCount = votersByElection.get(election._id.toString()) ?? 0;
    // >50% quorum threshold
    if (voterCount <= Math.floor(eligibleVoterCount / 2)) continue;

    // Halve the remaining timer: new endTurn = currentTurn + ceil((endTurn - currentTurn) / 2)
    const remaining = election.endTurn - currentTurn;
    const halvedRemaining = Math.ceil(remaining / 2);
    const newEndTurn = currentTurn + halvedRemaining;

    acceleratedIds.push(election._id);
    acceleratedUpdates.push({
      electionId: election._id,
      newEndTurn,
      originalEndTurn: election.endTurn,
    });
  }

  if (acceleratedIds.length === 0) return 0;

  // Apply acceleration updates
  const bulkOps = acceleratedUpdates.map(({ electionId, newEndTurn, originalEndTurn }) => ({
    updateOne: {
      filter: { _id: electionId },
      update: {
        $set: {
          endTurn: newEndTurn,
          // Preserve the pre-acceleration end turn so the NEXT election for this
          // position is deferred until the cycle would naturally have ended —
          // keeping chair in lockstep with viceChair/treasurer instead of
          // drifting ahead. Consumed by createMissingNationalElections.
          originalEndTurn,
          // Recalculate wall-clock endTime for display (1 turn ≈ 1h)
          endTime: new Date(Date.now() + (newEndTurn - currentTurn) * 60 * 60 * 1000),
          quorumAcceleratedAtTurn: currentTurn,
          updatedAt: new Date(),
        },
      },
    },
  }));

  await db.collection<NationalPartyElection>("nationalPartyElections").bulkWrite(bulkOps);

  console.log(
    `[NationalPartyElections] Quorum acceleration applied to ${acceleratedIds.length} chair election(s) ` +
      `(>50% members voted, chair seat vacant, timer halved)`
  );

  return acceleratedIds.length;
}

// ─── Main entry point (called from turn system) ──────────────────────────────

/**
 * Evict inactive NATIONAL party leadership (chair / vice-chair / treasurer),
 * mirroring {@link vacateInactiveLeadership} for state-party orgs (#3308,
 * follow-up to #972 / PR #3303). Holders whose user fails {@link isUserActive}
 * at the lenient {@link LEADERSHIP_INACTIVE_TURN_THRESHOLD} have their seat
 * `$set` to null so the next cycle opens against an empty seat; an abandoned
 * national chair otherwise blocks quorum acceleration, which requires a vacant
 * chair to fire.
 *
 * National-specific concern the state path lacks: when a CHAIR is vacated we
 * must also null the led coalition's `chairCharacterId`, mirroring the
 * elected/vacated chairChanges sync in {@link processCompletedNationalElections}
 * — otherwise coalition leadership desyncs from the (now empty) party chair.
 *
 * Batched: one `politicalParties` scan, one `characters` find, one `users` find.
 * Fully inert when everyone is active. Missing character/user/activity data is
 * treated as active (skip-on-missing) so data gaps never punish a holder.
 *
 * @returns the number of seats vacated.
 */
