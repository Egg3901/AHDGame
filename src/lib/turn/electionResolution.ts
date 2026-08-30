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
  const [tallies, gameStateDoc] = await Promise.all([
    db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .find({ electionId: { $in: electionIds } })
      .toArray(),
    db.collection<GameState>("gameState").findOne({ _id: "current" }),
  ]);
  const currentTurn = gameStateDoc?.currentTurn ?? 0;
  const tallyMap = new Map(tallies.map((t) => [t.electionId.toString(), t]));

  let resolved = 0;
  const allNewsOutcomes: ElectionNewsOutcome[] = [];
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
            outcome: "ok",
            turn: currentTurn,
            meta: {
              electionType: election.electionType,
              state: election.state,
              countryId: election.countryId,
            },
          });
        }
        allNewsOutcomes.push(...result.newsOutcomes);
      }
    }
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
