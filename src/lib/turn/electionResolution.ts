import { getDb } from "@/lib/mongodb";
import type { ObjectId } from "mongodb";
import type { Election, ElectionVoteTally, GameState } from "@/lib/db/types";
import { generateElectionNews } from "@/lib/news";
import { HOUSE_SEATS, UK_COMMONS_SEATS } from "@/lib/constants";
import { spawnHouseElection, spawnCommonsElection } from "@/lib/turn/election/electionSpawning";
import {
  sendBatchedElectionResults,
  type ElectionNewsOutcome,
} from "@/lib/turn/election/electionNotifications";
import { resolveOneGeneralElection } from "@/lib/turn/election/generalResolution";
import { logger } from "../observability/logger";
import { recordAuditBulk } from "@/lib/audit/recordAudit";
import type { ActionAuditInput } from "@/lib/db/types/actionAuditLog";
import { resolvePresidentialWinnerCandidateId } from "@/lib/elections/presidentialResolutionDisplay";
import { TALLY_WITH_LATEST_SNAPSHOT_ONLY } from "@/lib/electionEngine/tallyProjections";
import { captureElectionResolved } from "@/lib/analytics/electionAnalytics";

export { HOUSE_SEATS, UK_COMMONS_SEATS };
export { spawnHouseElection, spawnCommonsElection };

/** House/Senate must resolve before president so contingent ballots use the incoming Congress. */
export function generalElectionResolutionOrder(election: Election): number {
  if (election.electionType === "president") return 2;
  if (election.electionType === "house" || election.electionType === "senate") return 0;
  return 1;
}

/**
 * Resolve all completed general elections by delegating each to resolveOneGeneralElection.
 * Batches news and Discord notifications after all elections are processed.
 */
export async function resolveGeneralElections(
  now: Date,
  /** Optional harness restriction to specific elections; absent = all. */
  onlyElectionIds?: ObjectId[]
): Promise<number> {
  const db = await getDb();

  const completedElections = (
    await db
      .collection<Election>("elections")
      .find({
        ...(onlyElectionIds ? { _id: { $in: onlyElectionIds } } : {}),
        status: "completed",
      })
      .toArray()
  ).sort((a, b) => {
    const order = generalElectionResolutionOrder(a) - generalElectionResolutionOrder(b);
    if (order !== 0) return order;
    return a._id.toString().localeCompare(b._id.toString());
  });

  if (completedElections.length === 0) return 0;

  const electionIds = completedElections.map((e) => e._id);
  const [tallies, completedCandidates, gameStateDoc] = await Promise.all([
    db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .find({ electionId: { $in: electionIds } }, { projection: TALLY_WITH_LATEST_SNAPSHOT_ONLY })
      .toArray(),
    db
      .collection("electionCandidates")
      .find(
        { electionId: { $in: electionIds }, status: "active" },
        { projection: { electionId: 1, isNPP: 1 } }
      )
      .toArray()
      .catch(() => []),
    db.collection<GameState>("gameState").findOne({ _id: "current" }),
  ]);
  const currentTurn = gameStateDoc?.currentTurn ?? 0;
  const tallyMap = new Map(tallies.map((t) => [t.electionId.toString(), t]));
  const candidatesByElection = new Map<string, typeof completedCandidates>();
  for (const candidate of completedCandidates) {
    const key = candidate.electionId.toString();
    const list = candidatesByElection.get(key) ?? [];
    list.push(candidate);
    candidatesByElection.set(key, list);
  }

  let resolved = 0;
  const allNewsOutcomes: ElectionNewsOutcome[] = [];
  const resolvedElections: Election[] = [];
  // Forensics/alt-detection audit spine (plan §3.1, T2.7): one entry per
  // resolved election, flushed with ONE `recordAuditBulk` call after all
  // groups finish (never a per-election DB round trip — resolveGeneralElections
  // is already the phase that batches many elections into one turn phase).
  const actionAuditEntries: ActionAuditInput[] = [];

  // electionResolution was the worst slow turn phase (up to 169s) because each
  // election was resolved with a sequential `await`. resolveOneGeneralElection
  // only writes to THAT election's own docs (its elections row, its
  // electionVoteTallies, and the per-seat electedOfficials/characters/npps) — it
  // mutates no shared aggregate (gameState/party), so elections within the same
  // resolution-order group are independent and can run concurrently. Groups stay
  // SEQUENTIAL so the house/senate → down-ballot → president coattail/contingent
  // ordering (generalElectionResolutionOrder) is preserved: presidents still see
  // the freshly-seated Congress. Bounded so we don't overwhelm the Mongo pool;
  // set ELECTION_RESOLUTION_CONCURRENCY=1 to fall back to fully sequential.
  const concurrency = Math.max(1, Number(process.env.ELECTION_RESOLUTION_CONCURRENCY) || 4);

  // completedElections is pre-sorted by resolution order, so contiguous runs of
  // the same order form each group.
  const orderGroups: Election[][] = [];
  for (const election of completedElections) {
    const order = generalElectionResolutionOrder(election);
    const lastGroup = orderGroups[orderGroups.length - 1];
    if (lastGroup && generalElectionResolutionOrder(lastGroup[0]) === order) {
      lastGroup.push(election);
    } else {
      orderGroups.push([election]);
    }
  }

  for (const group of orderGroups) {
    for (let i = 0; i < group.length; i += concurrency) {
      const chunk = group.slice(i, i + concurrency);
      const chunkResults = await Promise.all(
        chunk.map(async (election) => {
          try {
            const tally = tallyMap.get(election._id.toString());
            const result = await resolveOneGeneralElection(db, election, tally, currentTurn, now);
            return { election, result };
          } catch (err) {
            console.error(
              `[Turn] Failed to resolve election ${election._id} (${election.electionType}/${election.state ?? "?"}) — skipping to avoid aborting remaining elections:`,
              err
            );
            return { election, result: null };
          }
        })
      );
      for (const { election, result } of chunkResults) {
        if (!result) continue;
        if (result.resolved) {
          resolved++;
          resolvedElections.push(election);
        }
        allNewsOutcomes.push(...result.newsOutcomes);
      }
    }
  }

  const resolvedPresidentIds = resolvedElections
    .filter((election) => election.electionType === "president")
    .map((election) => election._id);
  const finalPresidentTallies =
    resolvedPresidentIds.length > 0
      ? await db
          .collection<ElectionVoteTally>("electionVoteTallies")
          .find(
            { electionId: { $in: resolvedPresidentIds } },
            {
              projection: {
                electionId: 1,
                finalized: 1,
                candidateNames: 1,
                electoralVotesByCandidate: 1,
                resolutionMode: 1,
                contingentResult: 1,
              },
            }
          )
          .toArray()
      : [];
  const finalPresidentTallyMap = new Map(
    finalPresidentTallies.map((tally) => [tally.electionId.toString(), tally])
  );

  // A skipped atomic claim currently returns resolved=true to the game caller.
  // Telemetry must observe the committed status rather than that return value.
  // Read all outcome statuses together; a failure suppresses telemetry only.
  const committedOutcomeIds = new Set(
    completedElections.length > 0
      ? (
          await db
            .collection<Election>("elections")
            .find(
              {
                _id: { $in: completedElections.map((election) => election._id) },
                status: "resolved",
              },
              { projection: { _id: 1 } }
            )
            .toArray()
            .catch(() => [])
        ).map((election) => election._id.toString())
      : []
  );
  await Promise.all(
    completedElections
      .filter((election) => committedOutcomeIds.has(election._id.toString()))
      .map((election) => {
        const electionCandidates = candidatesByElection.get(election._id.toString()) ?? [];
        const tally = tallyMap.get(election._id.toString());
        const seatEstimateCount = Object.values(tally?.seatsEstimate ?? {}).reduce(
          (sum, seats) => sum + seats,
          0
        );
        const isNational =
          election.electionType === "president" ||
          election.electionType === "primeMinister" ||
          election.state === election.countryId;
        return captureElectionResolved({
          db,
          electionId: election._id.toString(),
          electionType: election.electionType,
          phase: "general",
          scope: isNational ? "national" : "regional",
          candidateCount: electionCandidates.length,
          playerCandidateCount: electionCandidates.filter((candidate) => !candidate.isNPP).length,
          turnoutPct: "unknown",
          seatsAvailable: election.totalSeats ?? (seatEstimateCount || 1),
          nationId: election.countryId,
          turn: currentTurn,
          iteration: gameStateDoc?.iteration,
        });
      })
  );

  for (const election of resolvedElections) {
    const finalTally = finalPresidentTallyMap.get(election._id.toString());
    const winnerId = finalTally?.electoralVotesByCandidate
      ? resolvePresidentialWinnerCandidateId(
          finalTally.electoralVotesByCandidate,
          finalTally.resolutionMode ?? "majority",
          finalTally.contingentResult
        )
      : null;
    actionAuditEntries.push({
      source: "turn",
      category: "election",
      action: "election.resolve",
      phase: "electionResolution",
      subject: {
        type: "election",
        id: election._id.toString(),
        name: `${election.electionType}/${election.state}`,
      },
      refs: { electionId: election._id },
      outcome: "ok",
      turn: currentTurn,
      meta: {
        electionType: election.electionType,
        state: election.state,
        countryId: election.countryId,
        ...(finalTally?.electoralVotesByCandidate && {
          winnerId,
          winnerName: winnerId ? finalTally.candidateNames?.[winnerId] : undefined,
          winnerElectoralVotes: winnerId
            ? (finalTally.electoralVotesByCandidate[winnerId] ?? 0)
            : undefined,
          resolutionMode: finalTally.resolutionMode ?? "majority",
          electoralVotesByCandidate: finalTally.electoralVotesByCandidate,
          contingentResult: finalTally.contingentResult,
        }),
      },
    });
  }

  if (actionAuditEntries.length > 0) {
    recordAuditBulk(actionAuditEntries);
  }

  if (resolved > 0) {
    console.log(`[Turn] Resolved ${resolved} general election(s)`);
    generateElectionNews(allNewsOutcomes).catch((err) =>
      logger.error("Turn", "Failed to generate election news", err)
    );
    sendBatchedElectionResults(db, allNewsOutcomes, now).catch((err) =>
      logger.error("Turn", "Failed to send batched election results", err)
    );
  }
  return resolved;
}
