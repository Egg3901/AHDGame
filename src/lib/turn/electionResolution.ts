/**
 * Completed elections resolve through their country's counting rules.
 * resolveGeneralElections certifies bound Duma cohorts together and defers
 * partial cohorts, preserving Congress until a separate chamber handover.
 */
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import {
  readyRussianDumaCohorts,
  readyRussianDumaRepeats,
} from "@/lib/countries/ru/rules/assemblyDispatch";
import { certifyRussianDumaRepeat } from "@/lib/countries/ru/dumaRepeatResult";
import {
  RUSSIAN_DUMA_REPEAT_OPENINGS_COLLECTION,
  type RussianDumaRepeatOpeningRecord,
} from "@/lib/countries/ru/dumaRepeatOpening";
import { certifyRussianDumaElection } from "@/lib/countries/ru/dumaElectionResult";
import type { Election, ElectionVoteTally, GameState, State } from "@/lib/db/types";
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
import { readBgOrdinaryEligibleParties } from "@/lib/turn/election/bgOrdinaryEligibility";
import { readHuMixedElectionPlan } from "@/lib/countries/hu/readMixedElectionPlan";
import type { HuMixedPlan } from "@/lib/countries/hu/rules/mixedElectionPlan";

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
      .find({ electionId: { $in: electionIds } }, { projection: TALLY_WITH_LATEST_SNAPSHOT_ONLY })
      .toArray(),
    db.collection<GameState>("gameState").findOne({ _id: "current" }),
  ]);
  const currentTurn = gameStateDoc?.currentTurn ?? 0;
  const tallyMap = new Map(tallies.map((t) => [t.electionId.toString(), t]));
  const bgOrdinaryRaces =
    gameStateDoc?.preset === "1991-default"
      ? completedElections.filter(
          (e) => e.countryId === "BG" && e.electionType === "nationalAssembly" && e.cycle === 1
        )
      : [];
  let bgEligibleParties: ReadonlySet<string> | null = null;
  if (bgOrdinaryRaces.length > 0) {
    bgEligibleParties = await readBgOrdinaryEligibleParties(db);
    if (!bgEligibleParties) {
      console.warn(
        "[Turn] Deferring Bulgaria 1991 Assembly resolution until all regional tallies are valid"
      );
    }
  }
  const huMixedCycles = new Set(
    gameStateDoc?.preset === "1991-default"
      ? completedElections
          .filter(
            (e) =>
              e.countryId === "HU" &&
              e.electionType === "nationalAssembly" &&
              (e.electionYear ?? 0) >= 2014
          )
          .map((e) => e.cycle)
      : []
  );
  const huMixedPlans = new Map<number, HuMixedPlan | null>();
  for (const cycle of huMixedCycles) {
    huMixedPlans.set(cycle, await readHuMixedElectionPlan(db, cycle));
  }

  let resolved = 0;
  if (gameStateDoc?.preset === "1991-default") {
    const cohorts = readyRussianDumaCohorts(
      completedElections.map((row) => ({
        id: row._id.toHexString(),
        countryId: row.countryId,
        electionType: row.electionType,
        status: row.status,
        endTurn: row.endTurn,
        seatId: row.seatId,
        totalSeats: row.totalSeats,
        binding: row.russianDumaRound
          ? {
              ...row.russianDumaRound,
              cohortId: row.russianDumaRound.cohortId.toHexString(),
              rootCohortId: row.russianDumaRound.rootCohortId?.toHexString(),
            }
          : undefined,
      })),
      currentTurn
    );
    for (const cohortId of cohorts) {
      try {
        await certifyRussianDumaElection({
          db,
          cohortId: new ObjectId(cohortId),
          turn: currentTurn,
          now,
        });
        resolved += 226;
      } catch (error) {
        logger.error("Turn", `Failed to certify Duma cohort ${cohortId}`, error);
      }
    }
    const repeatRows = completedElections.filter(
      (row) =>
        row.countryId === "RU" &&
        row.electionType === "dumaDeputy" &&
        row.russianDumaRound?.rootCohortId &&
        Number.isSafeInteger(row.russianDumaRound.generation) &&
        row.russianDumaRound.generation! > 0
    );
    if (repeatRows.length) {
      const openingIds = [
        ...new Set(
          repeatRows.map(
            (row) =>
              `${row.russianDumaRound!.rootCohortId!.toHexString()}:repeat:${row.russianDumaRound!.generation}`
          )
        ),
      ];
      const openings = await db
        .collection<RussianDumaRepeatOpeningRecord>(RUSSIAN_DUMA_REPEAT_OPENINGS_COLLECTION)
        .find(
          { _id: { $in: openingIds } },
          {
            projection: {
              rootCohortId: 1,
              cohortId: 1,
              generation: 1,
              mandateSinceTurn: 1,
              electionIds: 1,
              seatIds: 1,
            },
          }
        )
        .toArray();
      const ready = readyRussianDumaRepeats(
        repeatRows.map((row) => ({
          id: row._id.toHexString(),
          countryId: row.countryId,
          electionType: row.electionType,
          status: row.status,
          endTurn: row.endTurn,
          seatId: row.seatId,
          totalSeats: row.totalSeats,
          binding: {
            ...row.russianDumaRound!,
            cohortId: row.russianDumaRound!.cohortId.toHexString(),
            rootCohortId: row.russianDumaRound!.rootCohortId!.toHexString(),
          },
        })),
        openings.map((row) => ({
          ...row,
          rootCohortId: row.rootCohortId.toHexString(),
          cohortId: row.cohortId.toHexString(),
          electionIds: row.electionIds.map((id) => id.toHexString()),
        })),
        currentTurn
      );
      for (const opening of ready) {
        try {
          await certifyRussianDumaRepeat({
            db,
            rootCohortId: new ObjectId(opening.rootCohortId),
            generation: opening.generation,
            turn: currentTurn,
            now,
          });
          resolved += opening.electionIds.length;
        } catch (error) {
          logger.error("Turn", `Failed to certify Duma repeat ${opening.cohortId}`, error);
        }
      }
    }
  }
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
    if (
      election.countryId === "RU" &&
      election.electionType === "dumaDeputy" &&
      election.russianDumaRound
    )
      continue;
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
            if (bgOrdinaryRaces.includes(election) && !bgEligibleParties) {
              return { election, result: null };
            }
            const huPlan = huMixedPlans.get(election.cycle);
            const isHuMixed =
              huMixedCycles.has(election.cycle) &&
              election.countryId === "HU" &&
              election.electionType === "nationalAssembly";
            if (isHuMixed && !huPlan) return { election, result: null };
            if (isHuMixed && huPlan) {
              const capacity = huPlan.regionCapacity[election.state];
              if (!(capacity > 0))
                throw new Error("Hungary mixed race has no regional seat capacity");
              if (election.totalSeats !== capacity) {
                await db
                  .collection<Election>("elections")
                  .updateOne(
                    { _id: election._id, status: "completed" },
                    { $set: { totalSeats: capacity, updatedAt: now } }
                  );
                election.totalSeats = capacity;
              }
            }
            const tally = tallyMap.get(election._id.toString());
            const result = await resolveOneGeneralElection(
              db,
              election,
              tally,
              currentTurn,
              now,
              bgOrdinaryRaces.includes(election) ? bgEligibleParties : null,
              isHuMixed ? huPlan?.candidateSeatsByElection[election._id.toString()] : undefined
            );
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

  // Regional capacity can change when national list mandates move between
  // regions. Reconcile only after every race in the cycle has resolved.
  for (const [cycle, plan] of huMixedPlans) {
    if (!plan) continue;
    const pending = await db.collection<Election>("elections").countDocuments({
      countryId: "HU",
      electionType: "nationalAssembly",
      cycle,
      status: { $ne: "resolved" },
    });
    if (pending > 0) continue;
    await db.collection<State>("states").bulkWrite(
      Object.entries(plan.regionCapacity).map(([regionId, houseDistricts]) => ({
        updateOne: {
          filter: { _id: regionId, countryId: "HU" as const },
          update: { $set: { houseDistricts } },
        },
      }))
    );
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
