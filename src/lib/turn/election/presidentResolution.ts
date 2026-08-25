import { ObjectId } from "mongodb";
import type {
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  ElectedOfficial,
  NPP,
  Character,
  CharacterStateOrg,
  Campaign,
} from "@/lib/db/types";
import { updatePoliticianPagesAfterElection } from "@/lib/wiki/updatePoliticianPageOnElection";
import {
  allocateElectoralVotes,
  determinePresidentialWinner,
} from "@/lib/turn/electionCalculations";
import type { ContingentElectionResult } from "@/lib/turn/election/contingentElection";
import {
  markContingentResolutionPending,
  runPresidentialContingentBallot,
} from "@/lib/turn/election/presidentContingentBallot";
import { seatPresidentialExecutive } from "@/lib/turn/election/presidentExecutiveSeating";
import { recordPresidentialTenure } from "@/lib/turn/election/presidentialTenureLedger";
import {
  sendPresidentResolutionMessaging,
  type PresidentialResolutionMode,
} from "@/lib/turn/election/presidentResolutionMessaging";
import {
  isNppContingentId,
  toCharacterObjectId,
  toNppObjectId,
} from "@/lib/turn/election/contingentPersonIds";
import {
  resolvePresidentialWinnerCandidateId,
  electoralMajorityFor,
} from "@/lib/elections/presidentialResolutionDisplay";
import { getGameStateCollection } from "@/lib/db/collections";
import { loadApportionment } from "@/lib/elections/apportionment";
import { logger } from "../../observability/logger";

function recoverUnitVotesFromSnapshots(
  unitTurnSnapshots: ElectionVoteTally["unitTurnSnapshots"],
  activeCandidateIds: Set<string>
): Record<string, Record<string, number>> | null {
  if (!unitTurnSnapshots) return null;
  const recovered: Record<string, Record<string, number>> = {};
  let anyData = false;
  for (const [unitId, snaps] of Object.entries(unitTurnSnapshots)) {
    if (!Array.isArray(snaps) || snaps.length === 0) continue;
    const lastSnap = snaps[snaps.length - 1];
    if (!lastSnap?.cumulativeVotes) continue;
    const filtered: Record<string, number> = {};
    for (const [cid, votes] of Object.entries(lastSnap.cumulativeVotes)) {
      if (activeCandidateIds.has(cid) && votes > 0) filtered[cid] = votes;
    }
    if (Object.keys(filtered).length > 0) {
      recovered[unitId] = filtered;
      anyData = true;
    }
  }
  return anyData ? recovered : null;
}

function computeTiedEv(ranked: [string, number][]): number {
  if (ranked.length < 2) return 0;
  const topEv = ranked[0][1];
  return ranked.filter(([, ev]) => ev === topEv).length >= 2 ? topEv : 0;
}

async function vacatePresidency(
  db: Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>,
  election: Election,
  now: Date,
  reason: string
): Promise<void> {
  await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .updateOne({ electionId: election._id }, { $set: { finalized: true, updatedAt: now } });
  await db
    .collection("electionCandidates")
    .updateMany(
      { electionId: election._id, status: "active" },
      { $set: { status: "withdrawn", withdrawnAt: now } }
    );
  const vacateCountryId = election.countryId ?? "US";
  await db.collection<Character>("characters").updateMany(
    {
      countryId: vacateCountryId,
      "currentOffice.type": { $in: ["president", "vicePresident"] },
    },
    { $set: { currentOffice: null, updatedAt: now } }
  );
  await db.collection<NPP>("npps").updateMany(
    {
      countryId: vacateCountryId,
      "currentOffice.type": { $in: ["president", "vicePresident"] },
    },
    { $set: { currentOffice: null, updatedAt: now } }
  );
  await db.collection<ElectedOfficial>("electedOfficials").updateMany(
    { countryId: vacateCountryId, officeType: { $in: ["president", "vicePresident"] } },
    {
      $set: {
        characterId: null,
        characterName: null,
        party: null,
        isNPP: false,
        nppId: null,
        updatedAt: now,
      } as Record<string, unknown>,
    }
  );
  console.log(`[Turn] Vacated presidency — election ${election._id} ${reason}`);
}

async function resolveVpIds(
  db: Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>,
  election: Election,
  winnerCandidate: ElectionCandidate,
  contingentResult?: ContingentElectionResult
): Promise<{ vpCharId?: ObjectId; vpNppId?: ObjectId }> {
  let vpCharId: ObjectId | undefined;
  let vpNppId: ObjectId | undefined;

  if (contingentResult?.vicePresidentWinnerId) {
    const contingentVpId = contingentResult.vicePresidentWinnerId;
    if (isNppContingentId(contingentVpId)) {
      vpNppId = toNppObjectId(contingentVpId);
    } else {
      vpCharId = toCharacterObjectId(contingentVpId);
    }
  } else {
    vpCharId = winnerCandidate.runningMateId;
  }

  if (winnerCandidate.isNPP && winnerCandidate.nppId && !vpCharId && !vpNppId) {
    const vpNppCandidates = await db
      .collection<NPP>("npps")
      .find({
        party: winnerCandidate.party,
        countryId: election.countryId,
        _id: { $ne: winnerCandidate.nppId },
      })
      .sort({ politicalInfluence: -1 })
      .limit(1)
      .toArray();
    if (vpNppCandidates.length > 0) vpNppId = vpNppCandidates[0]._id;
  }

  return { vpCharId, vpNppId };
}

async function finalizePresidentTally(
  db: Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>,
  election: Election,
  electoralVotesByCandidate: Record<string, number>,
  resolutionMode: PresidentialResolutionMode,
  contingentResult: ContingentElectionResult | undefined,
  now: Date
): Promise<{ finalized: boolean; concurrentWinner: boolean }> {
  const tallyWrite = await db.collection<ElectionVoteTally>("electionVoteTallies").updateOne(
    { electionId: election._id, finalized: { $ne: true } },
    {
      $set: {
        electoralVotesByCandidate,
        finalized: true,
        updatedAt: now,
        resolutionMode,
        contingentResolutionPending: false,
        executiveSeatingPending: true,
        ...(contingentResult && {
          contingentResult: {
            eligiblePresidentCandidateIds: contingentResult.eligiblePresidentCandidateIds,
            eligibleVicePresidentCandidateIds: contingentResult.eligibleVicePresidentCandidateIds,
            houseDelegationVotes: contingentResult.houseDelegationVotes,
            houseVoteTotals: contingentResult.houseVoteTotals,
            senateVotes: contingentResult.senateVotes,
            senateVoteTotals: contingentResult.senateVoteTotals,
            presidentWinnerId: contingentResult.presidentWinnerId,
            vicePresidentWinnerId: contingentResult.vicePresidentWinnerId,
            houseThreshold: contingentResult.houseThreshold,
            senateThreshold: contingentResult.senateThreshold,
            deadlockBreakerUsed: contingentResult.deadlockBreakerUsed,
            deadlockBreakerReason: contingentResult.deadlockBreakerReason,
            topElectoralVoteTotal: contingentResult.topElectoralVoteTotal,
          },
        }),
      },
    }
  );

  if (tallyWrite.modifiedCount === 0) {
    return { finalized: false, concurrentWinner: true };
  }
  return { finalized: true, concurrentWinner: false };
}

async function runPostFinalizeCleanup(
  db: Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>,
  election: Election,
  electoralVotesByCandidate: Record<string, number>,
  now: Date
): Promise<void> {
  await db
    .collection("electionCandidates")
    .updateMany(
      { electionId: election._id, status: "active" },
      { $set: { status: "withdrawn", withdrawnAt: now } }
    );
  await db
    .collection<Campaign>("campaigns")
    .updateMany({ electionId: election._id }, { $set: { campaignStrength: 0, updatedAt: now } });
  await db.collection("campaigns").deleteMany({ electionId: election._id });

  // Half-up rounding via floor(x + 0.5) to match the previous Math.round behavior
  // ($round would use banker's rounding).
  const orgReset = await db
    .collection<CharacterStateOrg>("characterStateOrg")
    .updateMany({ level: { $gt: 0 } }, [
      {
        $set: {
          level: { $floor: { $add: [{ $multiply: ["$level", 0.25] }, 0.5] } },
          updatedAt: now,
        },
      },
    ]);
  if (orgReset.modifiedCount > 0) {
    console.log(
      `[Turn] President election ${election._id}: partial-25% state-org reset applied to ${orgReset.modifiedCount} row(s)`
    );
  }
}

/**
 * Resolve a completed presidential election: allocate EVs per unit, determine winner, update officials.
 */
export async function resolvePresidentElection(
  db: Awaited<ReturnType<typeof import("@/lib/mongodb").getDb>>,
  election: Election,
  tally: ElectionVoteTally,
  now: Date
): Promise<boolean> {
  const seatingRetryOnly = tally.finalized === true && tally.executiveSeatingPending === true;

  let electoralVotesByCandidate = tally.electoralVotesByCandidate;
  let ranked: [string, number][] = electoralVotesByCandidate
    ? Object.entries(electoralVotesByCandidate).sort((a, b) => b[1] - a[1])
    : [];
  let resolutionMode: PresidentialResolutionMode = tally.resolutionMode ?? "majority";
  // Majority of the ACTUAL college, not the modern 538-college constant: on
  // era worlds (531 EV in 1953-60) the hardcoded 270 would wrongly send a
  // 266-269 EV winner to a contingent House ballot. Both branches below
  // recompute this from the college they actually allocated.
  let evNeeded = electoralMajorityFor(
    electoralVotesByCandidate
      ? Object.values(electoralVotesByCandidate).reduce((s, v) => s + v, 0)
      : 0
  );
  let contingentResult: ContingentElectionResult | undefined = tally.contingentResult as
    ContingentElectionResult | undefined;

  if (!seatingRetryOnly) {
    let totalVotesByUnit = tally.totalVotesByUnit;
    const totalVotesByUnitIsEmpty =
      !totalVotesByUnit ||
      Object.keys(totalVotesByUnit).length === 0 ||
      Object.values(totalVotesByUnit).every((uv) => !uv || Object.values(uv).every((v) => !v));
    if (totalVotesByUnitIsEmpty) {
      const activeCandidateIds = new Set(Object.keys(tally.candidateNames ?? {}));
      const recovered = recoverUnitVotesFromSnapshots(tally.unitTurnSnapshots, activeCandidateIds);
      if (recovered) {
        console.warn(
          `[Turn] President election ${election._id}: totalVotesByUnit was empty — recovered ${Object.keys(recovered).length} unit(s) from last unitTurnSnapshot entries`
        );
        totalVotesByUnit = recovered;
      }
    }

    if (!totalVotesByUnit || Object.keys(totalVotesByUnit).length === 0) {
      await vacatePresidency(db, election, now, "resolved with no unit vote data");
      return true;
    }

    const presetGameState = await (await getGameStateCollection(db)).findOne({ _id: "current" });
    // Live (census-updated) EV units; equals the preset seed until a decennial
    // census reapportions (P1d-2).
    const evUnits = (await loadApportionment(db, presetGameState?.preset)).electoralVoteUnits;
    electoralVotesByCandidate = allocateElectoralVotes(totalVotesByUnit, evUnits);
    ranked = Object.entries(electoralVotesByCandidate).sort((a, b) => b[1] - a[1]);

    const totalEV = Object.values(electoralVotesByCandidate).reduce((s, v) => s + v, 0);
    if (totalEV === 0) {
      await vacatePresidency(db, election, now, "resolved with zero electoral votes");
      return true;
    }
    // Every unit allocates all of its electors, so the allocated sum IS the
    // college size for this world's apportionment.
    evNeeded = electoralMajorityFor(totalEV);
  }

  if (!electoralVotesByCandidate) {
    console.error(
      `[Turn] President election ${election._id}: missing electoral vote data during seating retry`
    );
    return false;
  }

  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ _id: { $in: Object.keys(electoralVotesByCandidate).map((id) => new ObjectId(id)) } })
    .toArray();
  const candidateMap = new Map(candidates.map((c) => [c._id.toString(), c]));

  let winnerId: string;
  let winnerEV: number;
  const tiedEv = computeTiedEv(ranked);

  if (seatingRetryOnly) {
    const retryWinnerId = resolvePresidentialWinnerCandidateId(
      electoralVotesByCandidate,
      resolutionMode,
      contingentResult
    );
    if (!retryWinnerId) {
      console.error(
        `[Turn] President election ${election._id}: seating retry could not resolve winner from finalized tally`
      );
      return false;
    }
    winnerId = retryWinnerId;
    winnerEV = electoralVotesByCandidate[winnerId] ?? ranked[0]?.[1] ?? 0;
  } else {
    const winner = determinePresidentialWinner(electoralVotesByCandidate, evNeeded);
    resolutionMode = "majority";
    contingentResult = undefined;

    if (winner) {
      winnerId = winner.winnerId;
      winnerEV = winner.winnerEV;
    } else {
      try {
        contingentResult = await runPresidentialContingentBallot(
          db,
          election,
          tally,
          candidates,
          electoralVotesByCandidate,
          now
        );
      } catch (err) {
        console.error(
          `[Turn] President election ${election._id}: contingent resolution failed — will retry next turn`,
          err
        );
        await markContingentResolutionPending(db, election._id, now);
        return false;
      }

      winnerId = contingentResult.presidentWinnerId;
      winnerEV = electoralVotesByCandidate[winnerId] ?? ranked[0][1];
      resolutionMode = contingentResult.resolutionMode;
      console.log(
        `[Turn] President election ${election._id}: no EV majority (${tiedEv > 0 ? `${tiedEv}–${tiedEv} tie` : "pluralities"}), House contingent winner ${winnerId} (${contingentResult.houseVoteTotals[winnerId] ?? 0} state delegations)`
      );
    }

    const winnerCandidateCheck = candidateMap.get(winnerId);
    if (!winnerCandidateCheck) {
      console.error(
        `[Turn] President election ${election._id}: winner ${winnerId} has no ElectionCandidate document — resolution skipped. Data may be corrupt; will retry next turn.`
      );
      return false;
    }

    const { finalized, concurrentWinner } = await finalizePresidentTally(
      db,
      election,
      electoralVotesByCandidate,
      resolutionMode,
      contingentResult,
      now
    );
    if (concurrentWinner) {
      console.log(
        `[Turn] President election ${election._id} — tally already finalized by concurrent process, skipping duplicate resolution`
      );
      return true;
    }
    if (finalized) {
      await runPostFinalizeCleanup(db, election, electoralVotesByCandidate, now);
    }
  }

  const winnerCandidate = candidateMap.get(winnerId);
  if (!winnerCandidate) {
    console.error(
      `[Turn] President election ${election._id}: winner ${winnerId} has no ElectionCandidate document`
    );
    return false;
  }

  const { vpCharId, vpNppId } = await resolveVpIds(db, election, winnerCandidate, contingentResult);

  try {
    await seatPresidentialExecutive(db, {
      election,
      winnerCandidate,
      vpCharId,
      vpNppId,
      now,
    });
  } catch (err) {
    console.error(
      `[Turn] President election ${election._id}: executive seating failed — will retry next turn`,
      err
    );
    await db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .updateOne(
        { electionId: election._id },
        { $set: { executiveSeatingPending: true, updatedAt: now } }
      );
    return false;
  }

  await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .updateOne(
      { electionId: election._id },
      { $set: { executiveSeatingPending: false, updatedAt: now } }
    );

  // Advance the consecutive-tenure ledger: same party extends the streak, a
  // flip resets it. Feeds the party-tenure voter-fatigue penalty on the next
  // presidential race. Best-effort — a ledger write must not fail resolution.
  try {
    await recordPresidentialTenure(db, election.countryId ?? "US", winnerCandidate.party);
  } catch (err) {
    logger.error("Turn", "Failed to record presidential tenure ledger", err);
  }

  const candidateIds = Object.keys(electoralVotesByCandidate).map((id) => new ObjectId(id));
  const winnerCandidateIds = new Set([winnerId]);
  const loserCandidateIds = new Set(ranked.slice(1).map(([id]) => id));
  updatePoliticianPagesAfterElection(
    db,
    election,
    candidateIds.map((id) => id.toString()),
    tally,
    winnerCandidateIds,
    loserCandidateIds,
    electoralVotesByCandidate,
    now
  ).catch((err) => logger.error("Turn", "Failed to update politician pages", err));

  await sendPresidentResolutionMessaging(db, {
    election,
    ranked,
    candidateMap,
    winnerId,
    winnerCandidate,
    winnerEV,
    resolutionMode,
    tiedEv,
    contingentResult,
    vpCharId,
    now,
    evNeeded,
  });

  console.log(
    `[Turn] President election ${election._id} resolved — ${winnerCandidate.characterName} wins with ${winnerEV} EV`
  );

  return true;
}
