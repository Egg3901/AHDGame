/**
 * Hungarian Assembly campaigns freeze the registered electorate before counting.
 * All six regional races bind to one statutory receipt in a required transaction;
 * an incomplete legacy cohort remains pending rather than changing counting rules.
 */
import { type ClientSession, type Db } from "mongodb";
import type { Election, GameState, State, StateRegistrationPool } from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { scalePoolToRegistered } from "@/lib/electionEngine/rules/registration";
import { HU_1991_TERRITORIAL_DISTRICTS } from "./data/electoralDistricts1991";

export async function materializeHu1991CampaignBinding(input: {
  db: Db;
  session: ClientSession;
  cycle: number;
  now: Date;
}): Promise<boolean> {
  const { db, session, cycle, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(cycle) ||
    cycle < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Hungarian campaign binding needs an active transaction, cycle and time");
  const game = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { session, projection: { preset: 1 } });
  if (game?.preset !== "1991-default") return false;
  const elections = await db
    .collection<Election>("elections")
    .find(
      {
        countryId: "HU",
        electionType: "nationalAssembly",
        cycle,
        "hungarianAssemblyRound.round": { $ne: 2 },
        "hungarianAssemblyRound.byElection": { $exists: false },
      },
      { session, projection: { state: 1, status: 1, electionYear: 1, hungarianAssemblyRound: 1 } }
    )
    .toArray();
  const regions = [...new Set(HU_1991_TERRITORIAL_DISTRICTS.map((row) => row.regionId))];
  if (
    elections.length !== 6 ||
    new Set(elections.map((row) => row.state)).size !== 6 ||
    elections.some(
      (row) =>
        !regions.includes(row.state) ||
        (row.electionYear ?? 0) >= 2014 ||
        row.status === "cancelled"
    ) ||
    elections.every((row) => row.status === "resolved")
  )
    return false;
  const receiptId = `HU:mixed1989:${cycle}`;
  if (elections.some((row) => row.hungarianAssemblyRound)) {
    if (
      elections.some(
        (row) =>
          row.hungarianAssemblyRound?.receiptId !== receiptId ||
          row.hungarianAssemblyRound?.round !== 1 ||
          row.hungarianAssemblyRound?.ruleVersion !== "mixed-1989-v1" ||
          !Number.isSafeInteger(row.hungarianAssemblyRound?.registeredVoters) ||
          (row.hungarianAssemblyRound?.registeredVoters ?? 0) < 1
      )
    )
      throw new Error("Hungarian frozen campaign cohort is incomplete or changed");
    return false;
  }
  const states = await db
    .collection<State>("states")
    .find(
      { countryId: "HU" },
      {
        session,
        projection: { _id: 1, population: 1, votingEligiblePopulation: 1 },
      }
    )
    .toArray();
  const pools = await db
    .collection<StateRegistrationPool>("stateRegistrationPool")
    .find(
      { countryId: "HU" },
      {
        session,
        projection: { stateId: 1, unregistered: 1 },
      }
    )
    .toArray();
  if (
    states.length !== 6 ||
    new Set(states.map((row) => String(row._id))).size !== 6 ||
    states.some((row) => !regions.includes(String(row._id))) ||
    new Set(pools.map((row) => row.stateId)).size !== pools.length
  )
    throw new Error("Hungarian registration requires one authoritative row per region");
  const poolMap = new Map(pools.map((row) => [row.stateId, row.unregistered]));
  const register = new Map(
    states.map((row) => {
      const eligible = row.votingEligiblePopulation ?? row.population;
      if (!Number.isSafeInteger(eligible) || eligible < 1)
        throw new Error("Invalid Hungarian regional electorate");
      const voters = Math.floor(scalePoolToRegistered(eligible, poolMap.get(String(row._id))));
      if (!Number.isSafeInteger(voters) || voters < 1)
        throw new Error("Hungarian region has no registered electorate");
      return [String(row._id), voters];
    })
  );
  const result = await db.collection<Election>("elections").bulkWrite(
    elections.map((row) => ({
      updateOne: {
        filter: { _id: row._id, hungarianAssemblyRound: { $exists: false } },
        update: {
          $set: {
            hungarianAssemblyRound: {
              ruleVersion: "mixed-1989-v1" as const,
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
  if (result.modifiedCount !== 6)
    throw new Error("Hungarian campaign binding changed concurrently");
  await db.collection("electionVoteTallies").updateMany(
    { electionId: { $in: elections.map((row) => row._id) }, finalized: { $ne: true } },
    {
      $set: { hungarianAssemblyBallot: true },
      $unset: { seatsEstimate: "" },
    },
    { session }
  );
  return true;
}

/** Read-only fast path avoids a transaction on already bound steady turns. */
export async function bindHu1991Campaigns(
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
        countryId: "HU",
        electionType: "nationalAssembly",
        status: { $in: ["upcoming", "active", "completed"] },
        hungarianAssemblyRound: { $exists: false },
        ...(cycles ? { cycle: { $in: cycles } } : {}),
        $or: [{ electionYear: { $lt: 2014 } }, { electionYear: { $exists: false } }],
      },
      { projection: { cycle: 1 } }
    )
    .toArray();
  let bound = 0;
  for (const cycle of new Set(
    unbound.map((row) => row.cycle).filter((value) => Number.isSafeInteger(value) && value >= 1)
  ))
    if (
      await runRequiredTransaction((session) =>
        materializeHu1991CampaignBinding({ db, session, cycle, now })
      )
    )
      bound += 6;
  return bound;
}
