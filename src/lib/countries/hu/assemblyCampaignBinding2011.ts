/**
 * Hungary freezes its authorized modern electoral system before general voting.
 * Whole primary cohorts retain filed people and campaign accounts; started votes,
 * by-elections, second rounds and certified old counts retain their earlier law.
 */
import type { ClientSession, Db } from "mongodb";
import type {
  CountryGameState,
  Election,
  ElectionVoteTally,
  GameState,
  State,
} from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { calendarTurn } from "@/lib/utils/gameDate";
import { HU_1991_TERRITORIAL_DISTRICTS } from "./data/electoralDistricts1991";
import { hu2014RegionSeats } from "@/lib/turn/huAssemblyReform";
import { huAssemblyElectionSystem } from "./rules/electoralTransition2011";

export async function bindHu2011Campaigns(db: Db, game: GameState, turn: number, now: Date) {
  if (game.preset !== "1991-default") return false;
  const country = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne({ _id: "HU" }, { projection: { huElectoralSystem2011SinceTurn: 1 } });
  if (
    huAssemblyElectionSystem({
      calendarTurn: calendarTurn(turn, {
        preIterationActive: game.preIteration?.active,
        preIterationTurns: game.preIterationTurns,
      }),
      authorizedTurn: country?.huElectoralSystem2011SinceTurn,
      legacyModernAssemblyYear: game.huAssemblyReformedAtYear,
    }) !== "mixed-2011-v1"
  )
    return false;
  const pending = await db.collection<Election>("elections").findOne(
    {
      countryId: "HU",
      electionType: "nationalAssembly",
      cycle: { $gte: 1 },
      status: { $in: ["active", "upcoming"] },
      hungarianModernAssembly: { $exists: false },
      "hungarianAssemblyRound.round": { $ne: 2 },
      "hungarianAssemblyRound.byElection": { $exists: false },
    },
    { projection: { _id: 1 } }
  );
  if (!pending) return false;
  return runRequiredTransaction(
    async (session) => {
      await materializeHu2011PrimaryCohorts(
        db,
        turn,
        now,
        session,
        country?.huElectoralSystem2011SinceTurn
      );
      return true;
    },
    { client: db.client }
  );
}

/** An existing primary can adopt the law only before any general ballot exists. */
async function materializeHu2011PrimaryCohorts(
  db: Db,
  turn: number,
  now: Date,
  session: ClientSession,
  authorizedOnTurn?: number
) {
  const polls = await db
    .collection<Election>("elections")
    .find(
      {
        countryId: "HU",
        electionType: "nationalAssembly",
        cycle: { $gte: 1 },
        status: { $in: ["upcoming", "active"] },
        "hungarianAssemblyRound.round": { $ne: 2 },
        hungarianModernAssembly: { $exists: false },
        "hungarianAssemblyRound.byElection": { $exists: false },
      },
      {
        session,
        projection: {
          cycle: 1,
          state: 1,
          primaryEndTurn: 1,
          primaryEndTime: 1,
          hungarianAssemblyRound: 1,
          hungarianModernAssembly: 1,
        },
      }
    )
    .toArray();
  const candidates = [...new Set(polls.map((row) => row.cycle))].flatMap((cycle) => {
    const cohort = polls.filter((row) => row.cycle === cycle);
    return cohort.length === 6 &&
      new Set(cohort.map((row) => row.state)).size === 6 &&
      cohort.every((row) =>
        HU_1991_TERRITORIAL_DISTRICTS.some((district) => district.regionId === row.state)
      ) &&
      cohort.every((row) =>
        row.primaryEndTurn != null
          ? row.primaryEndTurn > turn
          : row.primaryEndTime != null && row.primaryEndTime > now
      )
      ? cohort
      : [];
  });
  if (!candidates.length) return;
  const receipts = await db
    .collection<{ _id: string }>("hu1991AssemblyCounts")
    .find(
      {
        _id: {
          $in: candidates.flatMap((row) =>
            row.hungarianAssemblyRound ? [row.hungarianAssemblyRound.receiptId] : []
          ),
        },
      },
      { session, projection: { _id: 1 } }
    )
    .toArray();
  const frozen = new Set(receipts.map((row) => String(row._id)));
  const tallies = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .find(
      {
        electionId: { $in: candidates.map((row) => row._id) },
      },
      {
        session,
        projection: { electionId: 1, finalized: 1, totalVotes: 1, turnSnapshots: { $slice: -1 } },
      }
    )
    .toArray();
  const withVotes = new Set(
    tallies
      .filter(
        (row) =>
          row.finalized ||
          Object.values(row.totalVotes ?? {}).some((votes) => votes > 0) ||
          Object.values(row.turnSnapshots?.at(-1)?.cumulativeVotes ?? {}).some((votes) => votes > 0)
      )
      .map((row) => row.electionId.toHexString())
  );
  const eligibleCycles = [...new Set(candidates.map((row) => row.cycle))].filter((cycle) =>
    candidates
      .filter((row) => row.cycle === cycle)
      .every(
        (row) =>
          (!row.hungarianAssemblyRound || !frozen.has(row.hungarianAssemblyRound.receiptId)) &&
          !withVotes.has(row._id.toHexString())
      )
  );
  const eligible = candidates.filter((row) => eligibleCycles.includes(row.cycle));
  if (!eligible.length) return;
  await db.collection<ElectionVoteTally>("electionVoteTallies").updateMany(
    {
      electionId: { $in: eligible.map((row) => row._id) },
    },
    { $set: { updatedAt: now } },
    { session }
  );
  const regions = await db
    .collection<State>("states")
    .find({ countryId: "HU" }, { session, projection: { _id: 1, population: 1 } })
    .toArray();
  const capacities = hu2014RegionSeats(regions);
  if (Object.keys(capacities).length !== 6)
    throw new Error("Modern Hungarian binding needs six regions");
  const changed = await db.collection<Election>("elections").bulkWrite(
    eligible.map((row) => ({
      updateOne: {
        filter: {
          _id: row._id,
          status: { $in: ["active", "upcoming"] },
          "hungarianAssemblyRound.round": { $ne: 2 },
        },
        update: {
          $set: {
            totalSeats: capacities[row.state],
            hungarianModernAssembly: {
              ruleVersion: "mixed-2011-v1",
              ...(authorizedOnTurn != null ? { authorizedOnTurn } : {}),
              reason: authorizedOnTurn != null ? "parliamentary_decision" : "legacy_settlement",
            },
            updatedAt: now,
          },
          $unset: { hungarianAssemblyRound: "" },
        },
      },
    })),
    { session }
  );
  if (changed.matchedCount !== eligible.length)
    throw new Error("Primary cohort changed during electoral authorization");
}
