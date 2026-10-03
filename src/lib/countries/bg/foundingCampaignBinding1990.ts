/**
 * Bulgarian Assembly campaigns freeze the registered electorate before counting.
 * All five regional races bind to one statutory receipt in a required transaction;
 * an incomplete legacy cohort remains pending rather than changing counting rules.
 */
import { type ClientSession, type Db } from "mongodb";
import type { Election, GameState, State, StateRegistrationPool } from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { scalePoolToRegistered } from "@/lib/electionEngine/rules/registration";
import { BG_1990_LIST_DISTRICTS } from "./data/foundingDistricts1990";
import { isBgOrdinaryCapacity } from "./rules/assemblyTransition";

export async function materializeBgFoundingCampaignBinding(input: {
  db: Db;
  session: ClientSession;
  cycle: number;
  now: Date;
}): Promise<boolean> {
  const { db, session, cycle, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(cycle) ||
    cycle < 0 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Bulgarian campaign binding needs an active transaction, cycle and time");
  const game = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { session, projection: { preset: 1 } });
  if (game?.preset !== "1991-default") return false;
  const elections = await db
    .collection<Election>("elections")
    .find(
      {
        countryId: "BG",
        electionType: "nationalAssembly",
        cycle,
        "bulgarianFoundingRound.round": { $ne: 2 },
        "bulgarianFoundingRound.byElection": { $exists: false },
      },
      {
        session,
        projection: {
          state: 1,
          status: 1,
          electionYear: 1,
          bulgarianFoundingRound: 1,
          totalSeats: 1,
        },
      }
    )
    .toArray();
  const regions = [...new Set(BG_1990_LIST_DISTRICTS.map((row) => row.regionId))];
  if (
    elections.length !== 5 ||
    new Set(elections.map((row) => row.state)).size !== 5 ||
    elections.some((row) => !regions.includes(row.state) || row.status === "cancelled") ||
    elections.every((row) => row.status === "resolved") ||
    elections.reduce((sum, row) => sum + (row.totalSeats ?? 0), 0) !== 400
  )
    return false;
  const receiptId = `BG:founding1990:${cycle}`;
  if (elections.some((row) => row.bulgarianFoundingRound)) {
    if (
      elections.some(
        (row) =>
          row.bulgarianFoundingRound?.receiptId !== receiptId ||
          row.bulgarianFoundingRound?.round !== 1 ||
          row.bulgarianFoundingRound?.ruleVersion !== "parallel-1990-v1" ||
          !Number.isSafeInteger(row.bulgarianFoundingRound?.registeredVoters) ||
          (row.bulgarianFoundingRound?.registeredVoters ?? 0) < 1
      )
    )
      throw new Error("Bulgarian frozen campaign cohort is incomplete or changed");
    return false;
  }
  const states = await db
    .collection<State>("states")
    .find(
      { countryId: "BG" },
      {
        session,
        projection: { _id: 1, population: 1, votingEligiblePopulation: 1 },
      }
    )
    .toArray();
  const pools = await db
    .collection<StateRegistrationPool>("stateRegistrationPool")
    .find(
      { countryId: "BG" },
      {
        session,
        projection: { stateId: 1, unregistered: 1 },
      }
    )
    .toArray();
  if (
    states.length !== 5 ||
    new Set(states.map((row) => String(row._id))).size !== 5 ||
    states.some((row) => !regions.includes(String(row._id))) ||
    new Set(pools.map((row) => row.stateId)).size !== pools.length
  )
    throw new Error("Bulgarian registration requires one authoritative row per region");
  const poolMap = new Map(pools.map((row) => [row.stateId, row.unregistered]));
  const register = new Map(
    states.map((row) => {
      const eligible = row.votingEligiblePopulation ?? row.population;
      if (!Number.isSafeInteger(eligible) || eligible < 1)
        throw new Error("Invalid Bulgarian regional electorate");
      const voters = Math.floor(scalePoolToRegistered(eligible, poolMap.get(String(row._id))));
      if (!Number.isSafeInteger(voters) || voters < 1)
        throw new Error("Bulgarian region has no registered electorate");
      return [String(row._id), voters];
    })
  );
  const result = await db.collection<Election>("elections").bulkWrite(
    elections.map((row) => ({
      updateOne: {
        filter: { _id: row._id, bulgarianFoundingRound: { $exists: false } },
        update: {
          $set: {
            bulgarianFoundingRound: {
              ruleVersion: "parallel-1990-v1" as const,
              receiptId,
              round: 1 as const,
              registeredVoters: register.get(row.state)!,
              rootElectionId: row._id.toHexString(),
            },
            updatedAt: now,
          },
        },
      },
    })),
    { session }
  );
  if (result.modifiedCount !== 5)
    throw new Error("Bulgarian campaign binding changed concurrently");
  await db.collection("electionVoteTallies").updateMany(
    { electionId: { $in: elections.map((row) => row._id) }, finalized: { $ne: true } },
    {
      $set: { bulgarianFoundingBallot: true },
      $unset: { seatsEstimate: "" },
    },
    { session }
  );
  return true;
}

/** Read-only fast path avoids a transaction on already bound steady turns. */
export async function bindBgFoundingCampaigns(
  db: Db,
  now: Date,
  cycles?: readonly number[]
): Promise<number> {
  const game = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1 } });
  if (game?.preset !== "1991-default") return 0;
  const unbound = await db
    .collection<Election>("elections")
    .find(
      {
        countryId: "BG",
        electionType: "nationalAssembly",
        status: { $in: ["upcoming", "active", "completed"] },
        bulgarianFoundingRound: { $exists: false },
        ...(cycles ? { cycle: { $in: cycles } } : {}),
      },
      { projection: { cycle: 1, state: 1, totalSeats: 1 } }
    )
    .toArray();
  let bound = 0;
  for (const cycle of new Set(
    unbound
      .filter((row) => !isBgOrdinaryCapacity(row.state, row.totalSeats))
      .map((row) => row.cycle)
      .filter((value) => Number.isSafeInteger(value) && value >= 0)
  ))
    if (
      await runRequiredTransaction((session) =>
        materializeBgFoundingCampaignBinding({ db, session, cycle, now })
      )
    )
      bound += 5;
  return bound;
}
