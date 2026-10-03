/**
 * Completed elections resolve through their country's counting rules.
 * resolveGeneralElections certifies bound Duma cohorts together and defers
 * partial cohorts, preserving Congress until a separate chamber handover.
 */
import { bindBgFoundingCampaigns } from "@/lib/countries/bg/foundingCampaignBinding1990";
import {
  certifyBgFoundingFirstCount,
  BG_FOUNDING_COUNTS_COLLECTION,
  type BgFoundingAssemblyRecord,
} from "@/lib/countries/bg/foundingCount1990";
import {
  openBgFoundingRunoff,
  certifyBgFoundingRunoff,
} from "@/lib/countries/bg/foundingRunoff1990";
import { seatBgFoundingAssembly } from "@/lib/countries/bg/foundingSeating1990";
import { isBgOrdinaryCapacity } from "@/lib/countries/bg/rules/assemblyTransition";
import {
  certifyHu2011Count,
  HU_2011_COUNTS_COLLECTION,
  type Hu2011AssemblyRecord,
} from "@/lib/countries/hu/assemblyCount2011";
import {
  resolveHuModernByElection,
  HU_2011_BY_ELECTIONS_COLLECTION,
  type HuModernByElectionRecord,
} from "@/lib/countries/hu/constituencyByElections2011";
import { seatHu2011Assembly } from "@/lib/countries/hu/assemblySeating2011";
import { bindHu1991Campaigns } from "@/lib/countries/hu/assemblyCampaignBinding1991";
import {
  certifyHu1991FirstCount,
  HU_1991_COUNTS_COLLECTION,
  type Hu1991AssemblyRecord,
} from "@/lib/countries/hu/assemblyCount1991";
import { openHu1991Runoff, certifyHu1991Runoff } from "@/lib/countries/hu/assemblyRunoff1991";
import {
  resolveHu1991ByElection,
  HU_1991_BY_ELECTIONS_COLLECTION,
  type Hu1991ByElectionRecord,
} from "@/lib/countries/hu/constituencyByElections1991";
import { seatHu1991Assembly } from "@/lib/countries/hu/assemblySeating1991";
import type { ElectedOfficial } from "@/lib/db/types";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import {
  readyRussianDumaCohorts,
  readyRussianDumaRepeats,
} from "@/lib/countries/ru/rules/assemblyDispatch";
import { resolveRussianCouncilGenerations } from "@/lib/countries/ru/councilResolution";
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
import {
  BG_ORDINARY_PLANS_COLLECTION,
  readBgOrdinaryElectionPlan,
  type BgOrdinaryPlanRecord,
} from "@/lib/turn/election/bgOrdinaryEligibility";
import { seatBgOrdinaryAssembly } from "@/lib/countries/bg/ordinaryAssemblySeating";
import type { BgOrdinaryElectionPlan } from "@/lib/countries/bg/rules/ordinaryElectionPlan";
import { readHuMixedElectionPlan } from "@/lib/countries/hu/readMixedElectionPlan";
import type { HuMixedPlan } from "@/lib/countries/hu/rules/mixedElectionPlan";
import { captureElectionResolved } from "@/lib/analytics/electionAnalytics";
import { isNativeRussianAssemblyElection } from "@/lib/countries/ru/rules/assemblyElection";

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
  const genericElectionIds = completedElections
    .filter((e) => !isNativeRussianAssemblyElection(e))
    .map((e) => e._id);
  const [tallies, completedCandidates, gameStateDoc] = await Promise.all([
    db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .find({ electionId: { $in: electionIds } }, { projection: TALLY_WITH_LATEST_SNAPSHOT_ONLY })
      .toArray(),
    genericElectionIds.length
      ? db
          .collection("electionCandidates")
          .find(
            { electionId: { $in: genericElectionIds }, status: "active" },
            { projection: { electionId: 1, isNPP: 1 } }
          )
          .toArray()
          .catch(() => [])
      : Promise.resolve([]),
    db.collection<GameState>("gameState").findOne({ _id: "current" }),
  ]);
  const currentTurn = gameStateDoc?.currentTurn ?? 0;
  const tallyMap = new Map(tallies.map((t) => [t.electionId.toString(), t]));
  const bgFoundingRaces =
    gameStateDoc?.preset === "1991-default"
      ? completedElections.filter(
          (row) =>
            row.countryId === "BG" &&
            row.electionType === "nationalAssembly" &&
            (row.bulgarianFoundingRound != null || !isBgOrdinaryCapacity(row.state, row.totalSeats))
        )
      : [];
  const bgFoundingCycles = new Set(bgFoundingRaces.map((row) => row.cycle));
  if (onlyElectionIds && bgFoundingCycles.size) {
    const selected = new Set(onlyElectionIds.map((id) => id.toHexString()));
    const peers = await db
      .collection<Election>("elections")
      .find(
        {
          countryId: "BG",
          electionType: "nationalAssembly",
          cycle: { $in: [...bgFoundingCycles] },
        },
        { projection: { cycle: 1 } }
      )
      .toArray();
    for (const row of peers)
      if (!selected.has(row._id.toHexString())) bgFoundingCycles.delete(row.cycle);
  }
  if (bgFoundingCycles.size) await bindBgFoundingCampaigns(db, now, [...bgFoundingCycles]);
  const bgOrdinaryRaces =
    gameStateDoc?.preset === "1991-default"
      ? completedElections.filter(
          (e) =>
            e.countryId === "BG" &&
            e.electionType === "nationalAssembly" &&
            e.cycle >= 1 &&
            isBgOrdinaryCapacity(e.state, e.totalSeats)
        )
      : [];
  const bgPlans = new Map<number, BgOrdinaryElectionPlan | null>();
  for (const cycle of new Set(bgOrdinaryRaces.map((row) => row.cycle))) {
    bgPlans.set(cycle, await readBgOrdinaryElectionPlan(db, cycle, now));
  }
  const huModernByElectionRaces =
    gameStateDoc?.preset === "1991-default"
      ? completedElections.filter(
          (row) =>
            row.countryId === "HU" &&
            row.electionType === "nationalAssembly" &&
            row.hungarianModernByElection != null
        )
      : [];
  const huByElectionRaces =
    gameStateDoc?.preset === "1991-default"
      ? completedElections.filter(
          (row) =>
            row.countryId === "HU" &&
            row.electionType === "nationalAssembly" &&
            row.hungarianAssemblyRound?.byElection
        )
      : [];
  const hu1991Races =
    gameStateDoc?.preset === "1991-default"
      ? completedElections.filter(
          (row) =>
            row.countryId === "HU" &&
            row.electionType === "nationalAssembly" &&
            !row.hungarianAssemblyRound?.byElection &&
            row.cycle >= 1 &&
            row.hungarianModernAssembly == null &&
            !(gameStateDoc.huAssemblyReformedAtYear != null && !row.hungarianAssemblyRound)
        )
      : [];
  const hu1991Cycles = new Set(hu1991Races.map((row) => row.cycle));
  if (onlyElectionIds && hu1991Cycles.size) {
    const selected = new Set(onlyElectionIds.map((id) => id.toHexString()));
    const cohort = await db
      .collection<Election>("elections")
      .find(
        {
          countryId: "HU",
          electionType: "nationalAssembly",
          cycle: { $in: [...hu1991Cycles] },
        },
        { projection: { cycle: 1 } }
      )
      .toArray();
    for (const row of cohort)
      if (!selected.has(row._id.toHexString())) hu1991Cycles.delete(row.cycle);
  }
  if (hu1991Cycles.size) await bindHu1991Campaigns(db, now, [...hu1991Cycles]);
  const hu2011Races =
    gameStateDoc?.preset === "1991-default"
      ? completedElections.filter(
          (row) =>
            row.countryId === "HU" &&
            row.electionType === "nationalAssembly" &&
            row.hungarianModernAssembly?.ruleVersion === "mixed-2011-v1"
        )
      : [];
  const hu2011Cycles = new Set(hu2011Races.map((row) => row.cycle));
  if (onlyElectionIds && hu2011Cycles.size) {
    const selected = new Set(onlyElectionIds.map((id) => id.toHexString()));
    const peers = await db
      .collection<Election>("elections")
      .find(
        { countryId: "HU", electionType: "nationalAssembly", cycle: { $in: [...hu2011Cycles] } },
        { projection: { cycle: 1 } }
      )
      .toArray();
    for (const row of peers)
      if (!selected.has(row._id.toHexString())) hu2011Cycles.delete(row.cycle);
  }
  const huMixedCycles = new Set(
    gameStateDoc?.preset === "1991-default"
      ? completedElections
          .filter(
            (e) =>
              e.countryId === "HU" &&
              e.electionType === "nationalAssembly" &&
              e.hungarianModernAssembly == null &&
              e.hungarianModernByElection == null &&
              gameStateDoc.huAssemblyReformedAtYear != null &&
              !e.hungarianAssemblyRound
          )
          .map((e) => e.cycle)
      : []
  );
  const huMixedPlans = new Map<number, HuMixedPlan | null>();
  for (const cycle of huMixedCycles) {
    huMixedPlans.set(cycle, await readHuMixedElectionPlan(db, cycle));
  }
  const candidatesByElection = new Map<string, typeof completedCandidates>();
  for (const candidate of completedCandidates) {
    const key = candidate.electionId.toString();
    const list = candidatesByElection.get(key) ?? [];
    list.push(candidate);
    candidatesByElection.set(key, list);
  }

  const allNewsOutcomes: ElectionNewsOutcome[] = [];
  const resolvedElections: Election[] = [];
  let resolved = 0;
  for (const [cycle, plan] of bgPlans) {
    if (!plan) continue;
    try {
      if (await seatBgOrdinaryAssembly(db, cycle, currentTurn, now)) {
        resolved += 5;
        resolvedElections.push(...bgOrdinaryRaces.filter((row) => row.cycle === cycle));
        const receipt = await db
          .collection<BgOrdinaryPlanRecord>(BG_ORDINARY_PLANS_COLLECTION)
          .findOne({ _id: `BG:ordinary:${cycle}` });
        if (!receipt?.settledCandidateSeats)
          throw new Error("Committed Bulgarian seating receipt is missing");
        for (const election of bgOrdinaryRaces.filter((row) => row.cycle === cycle)) {
          const allocation = receipt.settledCandidateSeats[election._id.toHexString()];
          const tally = tallyMap.get(election._id.toHexString());
          if (tally) tally.seatsEstimate = allocation;
          for (const [candidateId, seats] of Object.entries(allocation)) {
            if (seats <= 0) continue;
            const nominee = receipt.nominees.find((row) => row.id === candidateId)!;
            allNewsOutcomes.push({
              electionType: "nationalAssembly",
              state: election.state,
              countryId: "BG",
              winnerName: nominee.name,
              winnerParty: nominee.party,
              isPlayer: !nominee.isNpc,
            });
          }
        }
      }
    } catch (error) {
      logger.error("Turn", `Bulgarian ordinary cycle ${cycle} remains unseated`, error);
    }
  }
  for (const receiptId of new Set(
    huModernByElectionRaces.map((row) => row.hungarianModernByElection!.receiptId)
  )) {
    try {
      if (onlyElectionIds) {
        const job = await db
          .collection<HuModernByElectionRecord>(HU_2011_BY_ELECTIONS_COLLECTION)
          .findOne({ _id: receiptId }, { projection: { electionIds: 1 } });
        const selected = new Set(onlyElectionIds.map((id) => id.toHexString()));
        if (!job || job.electionIds.some((id) => !selected.has(id))) continue;
      }
      const completed = await resolveHuModernByElection(db, receiptId, currentTurn, now);
      resolved += completed;
      if (completed) {
        resolvedElections.push(
          ...huModernByElectionRaces.filter(
            (row) => row.hungarianModernByElection!.receiptId === receiptId
          )
        );
        const job = await db
          .collection<HuModernByElectionRecord>(HU_2011_BY_ELECTIONS_COLLECTION)
          .findOne({ _id: receiptId }, { projection: { officialIds: 1 } });
        if (job?.officialIds?.length) {
          const winners = await db
            .collection<ElectedOfficial>("electedOfficials")
            .find(
              { _id: { $in: job.officialIds } },
              {
                projection: { state: 1, characterName: 1, party: 1, isNPP: 1 },
              }
            )
            .toArray();
          for (const winner of winners)
            allNewsOutcomes.push({
              electionType: "nationalAssembly",
              state: winner.state!,
              countryId: "HU",
              winnerName: winner.characterName ?? "Deputy",
              winnerParty: winner.party!,
              isPlayer: !winner.isNPP,
            });
        }
      }
    } catch (error) {
      logger.error(
        "Turn",
        `Modern Hungarian constituency receipt ${receiptId} remains unseated`,
        error
      );
    }
  }
  for (const receiptId of new Set(
    huByElectionRaces.map((row) => row.hungarianAssemblyRound!.receiptId)
  )) {
    try {
      if (onlyElectionIds) {
        const job = await db
          .collection<Hu1991ByElectionRecord>(HU_1991_BY_ELECTIONS_COLLECTION)
          .findOne({ _id: receiptId });
        const selected = new Set(onlyElectionIds.map((id) => id.toHexString()));
        if (!job || job.electionIds.some((id) => !selected.has(id))) continue;
      }
      const completed = await resolveHu1991ByElection(db, receiptId, currentTurn, now);
      resolved += completed;
      if (completed) {
        resolvedElections.push(
          ...huByElectionRaces.filter((row) => row.hungarianAssemblyRound!.receiptId === receiptId)
        );
        const job = await db
          .collection<Hu1991ByElectionRecord>(HU_1991_BY_ELECTIONS_COLLECTION)
          .findOne({ _id: receiptId }, { projection: { officialIds: 1 } });
        if (job?.officialIds?.length) {
          const winners = await db
            .collection<ElectedOfficial>("electedOfficials")
            .find(
              { _id: { $in: job.officialIds } },
              { projection: { state: 1, characterName: 1, party: 1, isNPP: 1 } }
            )
            .toArray();
          for (const winner of winners)
            allNewsOutcomes.push({
              electionType: "nationalAssembly",
              state: winner.state!,
              countryId: "HU",
              winnerName: winner.characterName ?? "Assembly Deputy",
              winnerParty: winner.party!,
              isPlayer: !winner.isNPP,
            });
        }
      }
    } catch (error) {
      logger.error("Turn", `Hungarian by-election ${receiptId} remains unseated`, error);
    }
  }
  for (const cycle of hu2011Cycles) {
    try {
      const receipt = await certifyHu2011Count(db, cycle, currentTurn, now);
      if (!receipt || !(await seatHu2011Assembly(db, cycle, currentTurn, now))) continue;
      const committed = await db
        .collection<Hu2011AssemblyRecord>(HU_2011_COUNTS_COLLECTION)
        .findOne({ _id: receipt._id });
      if (!committed?.settled) throw new Error("Hungarian modern handover receipt is missing");
      resolved += committed.electionIds.length;
      resolvedElections.push(...hu2011Races.filter((row) => row.cycle === cycle));
      for (const nominee of committed.nominees) {
        if ((committed.settled.candidateSeats[nominee.id] ?? 0) <= 0) continue;
        allNewsOutcomes.push({
          electionType: "nationalAssembly",
          state: nominee.regionId,
          countryId: "HU",
          winnerName: nominee.name,
          winnerParty: nominee.party,
          isPlayer: !nominee.isNpc,
        });
      }
    } catch (error) {
      logger.error("Turn", `Hungarian modern cycle ${cycle} remains unseated`, error);
    }
  }
  for (const cycle of bgFoundingCycles) {
    try {
      const receipt = await certifyBgFoundingFirstCount(db, cycle, currentTurn, now);
      if (!receipt) continue;
      if (receipt.count.kind === "pending") {
        await openBgFoundingRunoff(db, cycle, currentTurn, now);
        await certifyBgFoundingRunoff(db, cycle, currentTurn, now);
      }
      if (await seatBgFoundingAssembly(db, cycle, currentTurn, now)) {
        const settled = await db
          .collection<BgFoundingAssemblyRecord>(BG_FOUNDING_COUNTS_COLLECTION)
          .findOne({ _id: receipt._id });
        if (!settled?.settled) throw new Error("Bulgarian committed founding receipt is missing");
        resolved += settled.electionIds.length + (settled.runoffElectionIds?.length ?? 0);
        resolvedElections.push(...bgFoundingRaces.filter((row) => row.cycle === cycle));
        for (const [candidateId, seats] of Object.entries(settled.settled.candidateSeats)) {
          if (seats <= 0) continue;
          const nominee = settled.nominees.find((row) => row.id === candidateId)!;
          allNewsOutcomes.push({
            electionType: "nationalAssembly",
            state: nominee.regionId,
            countryId: "BG",
            winnerName: nominee.name,
            winnerParty: nominee.party,
            isPlayer: !nominee.isNpc,
          });
        }
      }
    } catch (error) {
      logger.error("Turn", `Bulgarian founding cycle ${cycle} remains unseated`, error);
    }
  }
  for (const cycle of hu1991Cycles) {
    try {
      const receipt = await certifyHu1991FirstCount(db, cycle, currentTurn, now);
      if (!receipt) continue;
      if (receipt.count.kind === "pending") {
        await openHu1991Runoff(db, cycle, currentTurn, now);
        await certifyHu1991Runoff(db, cycle, currentTurn, now);
      }
      if (await seatHu1991Assembly(db, cycle, currentTurn, now)) {
        const settled = await db
          .collection<Hu1991AssemblyRecord>(HU_1991_COUNTS_COLLECTION)
          .findOne({ _id: receipt._id });
        if (!settled?.settled) throw new Error("Hungarian committed handover receipt is missing");
        resolved += settled.electionIds.length + (settled.runoffElectionIds?.length ?? 0);
        resolvedElections.push(...hu1991Races.filter((row) => row.cycle === cycle));
        for (const [candidateId, seats] of Object.entries(settled.settled.candidateSeats)) {
          if (seats <= 0) continue;
          const nominee = settled.nominees.find((row) => row.id === candidateId)!;
          allNewsOutcomes.push({
            electionType: "nationalAssembly",
            state: nominee.regionId,
            countryId: "HU",
            winnerName: nominee.name,
            winnerParty: nominee.party,
            isPlayer: !nominee.isNpc,
          });
        }
      }
    } catch (error) {
      logger.error("Turn", `Hungarian mixed cycle ${cycle} remains unseated`, error);
    }
  }
  if (gameStateDoc?.preset === "1991-default") {
    resolved += await resolveRussianCouncilGenerations(db, completedElections, currentTurn, now);
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
      ((election.electionType === "dumaDeputy" && election.russianDumaRound) ||
        (election.electionType === "federationCouncilMember" && election.russianCouncilRound))
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
            if (
              bgOrdinaryRaces.includes(election) ||
              bgFoundingRaces.includes(election) ||
              hu1991Races.includes(election) ||
              hu2011Races.includes(election) ||
              huByElectionRaces.includes(election) ||
              huModernByElectionRaces.includes(election)
            ) {
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
              null,
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
