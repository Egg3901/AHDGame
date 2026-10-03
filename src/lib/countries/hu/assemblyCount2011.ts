/**
 * Hungary certifies its complete modern ballot before any region seats deputies.
 * The frozen national result and individual mandates share one required receipt;
 * replay keeps the original count and cannot change player or financial identity.
 */
import { type ClientSession, type Db } from "mongodb";
import type {
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  GameState,
  CountryGameState,
  State,
} from "@/lib/db/types";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { buildHuMixedPlan } from "./rules/mixedElectionPlan";
import { buildHuModernAssembly } from "./rules/modernAssembly2011";
import type { Hu1991AssemblyRecord } from "./assemblyCount1991";
import type { Hu1991InstalledMandates } from "./rules/mandates1991";
export const HU_2011_COUNTS_COLLECTION = "hu2011AssemblyCounts";
export interface Hu2011AssemblyRecord {
  _id: string;
  cycle: number;
  electionIds: string[];
  /** Frozen modern district boundaries remain stable throughout this Assembly term. */
  constituencies?: readonly { id: string; regionId: string }[];
  constituencyByElectionGeneration?: number;
  legacyResolvedElectionIds: string[];
  nominations: import("./rules/listVacancies1991").HuListNominations;
  nominees: Hu1991AssemblyRecord["nominees"];
  count: { kind: "counted" };
  installed: Hu1991InstalledMandates;
  createdAt: Date;
  seatedAtTurn?: number;
  seatedAt?: Date;
  officialIds?: import("mongodb").ObjectId[];
  settled?: Hu1991InstalledMandates;
}
export async function materializeHu2011Count(input: {
  db: Db;
  session: ClientSession;
  cycle: number;
  turn: number;
  now: Date;
}): Promise<Hu2011AssemblyRecord | null> {
  const { db, session, cycle, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(cycle) ||
    cycle < 1 ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Modern Hungarian count needs a transaction, cycle, turn and time");
  const journal = db.collection<Hu2011AssemblyRecord>(HU_2011_COUNTS_COLLECTION);
  const id = `HU:mixed2011:${cycle}`;
  const existing = await journal.findOne({ _id: id }, { session });
  if (existing) return existing;
  const game = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { session, projection: { preset: 1, huAssemblyReformedAtYear: 1 } }
    );
  if (game?.preset !== "1991-default") return null;
  const country = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne({ _id: "HU" }, { session, projection: { huElectoralSystem2011SinceTurn: 1 } });
  const polls = await db
    .collection<Election>("elections")
    .find(
      { countryId: "HU", electionType: "nationalAssembly", cycle },
      { session, projection: { state: 1, status: 1, hungarianModernAssembly: 1 } }
    )
    .toArray();
  if (
    polls.length !== 6 ||
    new Set(polls.map((row) => row.state)).size !== 6 ||
    polls.some(
      (row) =>
        row.status !== "completed" ||
        row.hungarianModernAssembly?.ruleVersion !== "mixed-2011-v1" ||
        (row.hungarianModernAssembly.reason === "parliamentary_decision"
          ? country?.huElectoralSystem2011SinceTurn == null ||
            row.hungarianModernAssembly.authorizedOnTurn !== country.huElectoralSystem2011SinceTurn
          : game.huAssemblyReformedAtYear == null)
    )
  )
    return null;
  const regions = await db
    .collection<State>("states")
    .find({ countryId: "HU" }, { session, projection: { _id: 1, population: 1 } })
    .toArray();
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find(
      { electionId: { $in: polls.map((row) => row._id) } },
      {
        session,
        projection: {
          electionId: 1,
          characterId: 1,
          nppId: 1,
          isNPP: 1,
          party: 1,
          status: 1,
          characterName: 1,
        },
      }
    )
    .toArray();
  const tallies = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .find(
      { electionId: { $in: polls.map((row) => row._id) } },
      { session, projection: { electionId: 1, totalVotes: 1, candidateParties: 1, finalized: 1 } }
    )
    .toArray();
  const byPoll = new Map(polls.map((row) => [row._id.toHexString(), row]));
  const byTally = new Map(tallies.map((row) => [row.electionId.toHexString(), row]));
  if (tallies.length !== 6 || tallies.some((row) => row.finalized)) return null;
  const plan = buildHuMixedPlan(
    regions.map((row) => ({ id: String(row._id), population: row.population })),
    polls.map((row) => {
      const tally = byTally.get(row._id.toHexString())!;
      return {
        electionId: row._id.toHexString(),
        regionId: row.state,
        candidates: Object.entries(tally.totalVotes ?? {}).map(([candidateId, votes]) => ({
          candidateId,
          partyId: tally.candidateParties[candidateId],
          votes,
        })),
      };
    })
  );
  const nominees = candidates
    .filter((row) => row.status === "active")
    .map((row) => ({
      id: row._id.toHexString(),
      ownerId: (row.isNPP ? row.nppId : row.characterId)?.toHexString() ?? "",
      electionId: row.electionId.toHexString(),
      isNpc: row.isNPP === true,
      party: row.party ?? "independent",
      name: row.characterName,
      regionId: byPoll.get(row.electionId.toHexString())!.state,
    }));
  const assembly = buildHuModernAssembly(
    plan,
    nominees.map((row) => ({
      id: row.id,
      ownerId: row.ownerId,
      partyId: row.party,
      regionId: row.regionId,
      isNpc: row.isNpc,
      votes: byTally.get(row.electionId)?.totalVotes[row.id] ?? 0,
    }))
  );
  if (!assembly) return null;
  const receipt: Hu2011AssemblyRecord = {
    _id: id,
    cycle,
    electionIds: polls.map((row) => row._id.toHexString()),
    legacyResolvedElectionIds: [],
    constituencies: Object.keys(plan.result.constituencyWinners)
      .sort()
      .map((districtId) => ({
        id: districtId,
        regionId: districtId.split(":")[0],
      })),
    nominations: {
      people: assembly.people,
      territorial: [],
      national: Object.entries(plan.result.listSeats)
        .filter(([, seats]) => seats > 0)
        .map(([partyId]) => ({
          partyId,
          candidateIds: assembly.people
            .filter((row) => row.partyId === partyId)
            .map((row) => row.id),
        })),
    },
    nominees,
    count: { kind: "counted" },
    installed: assembly.installed,
    createdAt: now,
  };
  await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .updateMany(
      { electionId: { $in: polls.map((row) => row._id) }, finalized: false },
      { $set: { updatedAt: now } },
      { session }
    );
  await journal.insertOne(receipt, { session });
  return receipt;
}
export async function certifyHu2011Count(db: Db, cycle: number, turn: number, now: Date) {
  return runRequiredTransaction(
    (session) => materializeHu2011Count({ db, session, cycle, turn, now }),
    { client: db.client }
  );
}
