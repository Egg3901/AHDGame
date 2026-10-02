/**
 * Duma certification loads frozen ballots and owner eligibility in bounded batches.
 * loadRussianDumaCertificationInputs serves initial and repeat rounds, retaining
 * counted withdrawals and avoiding a query per constituency or nominee.
 */
import { type ClientSession, type Db, type ObjectId } from "mongodb";
import type {
  Character,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  NPP,
} from "@/lib/db/types";
import { russianDumaConvocationOfficeCompatible } from "./rules/dumaConvocation";
import { loadPendingRussianCouncilOwners } from "./pendingCouncilMandates";
import type { RussianDumaResultRecord } from "./dumaElectionResult";
import type { RussianDumaCohortBallot } from "./rules/assemblyCohort";

export async function loadRussianDumaCertificationInputs(input: {
  db: Db;
  session: ClientSession;
  cohort: readonly Election[];
  councilCohortId?: ObjectId;
  convocationNumber?: number;
  protectedDumaPlayerOwners?: ReadonlySet<string>;
}) {
  const { db, session, cohort } = input;
  const electionIds = cohort.map((row) => row._id);
  const tallies = db.collection<ElectionVoteTally>("electionVoteTallies");
  const counted = await tallies
    .find(
      { electionId: { $in: electionIds } },
      {
        session,
        batchSize: 1000,
        projection: {
          electionId: 1,
          finalized: 1,
          totalVotes: 1,
          candidateParties: 1,
          russianDumaBallot: 1,
        },
      }
    )
    .toArray();
  if (
    counted.length !== cohort.length ||
    new Set(counted.map((row) => row.electionId.toHexString())).size !== cohort.length ||
    counted.some((row) => row.finalized || row.russianDumaBallot?.certifiedCohortId)
  )
    throw new Error("The Duma needs one unique unfinalized tally per ballot");
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find(
      { electionId: { $in: electionIds } },
      {
        session,
        batchSize: 1000,
        projection: {
          electionId: 1,
          characterId: 1,
          nppId: 1,
          isNPP: 1,
          characterName: 1,
          party: 1,
          countryId: 1,
          status: 1,
          russianDumaNomination: 1,
        },
      }
    )
    .toArray();
  const npcIds = candidates.filter((row) => row.isNPP && row.nppId).map((row) => row.nppId!);
  const playerIds = candidates.filter((row) => !row.isNPP).map((row) => row.characterId);
  const npcs = npcIds.length
    ? await db
        .collection<NPP>("npps")
        .find(
          {
            _id: { $in: npcIds },
            countryId: "RU",
            $or: [{ retiredAt: null }, { retiredAt: { $exists: false } }],
            isTechnocrat: { $ne: true },
          },
          { session, batchSize: 1000, projection: { party: 1, currentOffice: 1 } }
        )
        .toArray()
    : [];
  const players = playerIds.length
    ? await db
        .collection<Character>("characters")
        .find(
          {
            _id: { $in: playerIds },
            countryId: "RU",
            federationPendingResidenceId: { $exists: false },
          },
          { session, batchSize: 1000, projection: { party: 1, homeState: 1, currentOffice: 1 } }
        )
        .toArray()
    : [];
  const pendingCouncil = await loadPendingRussianCouncilOwners({
    db,
    session,
    cohortId: input.councilCohortId,
    mandateSinceTurn: cohort[0]?.russianDumaRound?.mandateSinceTurn,
  });
  const councilOwners = new Set([
    ...npcs
      .filter(
        (row) =>
          (typeof row.currentOffice === "string" ? row.currentOffice : row.currentOffice?.type) ===
          "federationCouncilMember"
      )
      .map((row) => `npc:${row._id.toHexString()}`),
    ...players
      .filter((row) => row.currentOffice?.type === "federationCouncilMember")
      .map((row) => `player:${row._id.toHexString()}`),
    ...pendingCouncil,
  ]);
  const owners = new Map<string, { party: string; homeState?: string; compatible: boolean }>([
    ...npcs.map(
      (row) =>
        [
          `npc:${row._id.toHexString()}`,
          {
            party: row.party,
            homeState: undefined,
            compatible:
              (input.convocationNumber ?? 1) === 1 ||
              russianDumaConvocationOfficeCompatible(
                input.convocationNumber!,
                typeof row.currentOffice === "string" ? row.currentOffice : row.currentOffice?.type,
                "RU"
              ),
          },
        ] as const
    ),
    ...players.map(
      (row) =>
        [
          `player:${row._id.toHexString()}`,
          {
            party: row.party,
            homeState: row.homeState,
            compatible:
              (input.convocationNumber ?? 1) === 1 ||
              russianDumaConvocationOfficeCompatible(
                input.convocationNumber!,
                row.currentOffice?.type,
                "RU"
              ),
          },
        ] as const
    ),
  ]);
  const rosterByElection = new Map<string, ElectionCandidate[]>();
  for (const candidate of candidates) {
    const id = candidate.electionId.toHexString();
    const roster = rosterByElection.get(id) ?? [];
    roster.push(candidate);
    rosterByElection.set(id, roster);
  }
  const tallyByElection = new Map(counted.map((row) => [row.electionId.toHexString(), row]));
  const registeredCandidateIds = new Set<string>();
  const votesByElection: RussianDumaResultRecord["votesByElection"] = {};
  const ballots: RussianDumaCohortBallot[] = cohort.map((election) => {
    const id = election._id.toHexString();
    const tally = tallyByElection.get(id)!;
    // A pre-count withdrawal is absent from the frozen ballot. A withdrawal
    // after counting retains its votes but cannot receive a mandate.
    const roster = (rosterByElection.get(id) ?? []).filter(
      (row) =>
        row.status === "active" ||
        Object.prototype.hasOwnProperty.call(tally.totalVotes, row._id.toHexString())
    );
    const keys = roster
      .map((row) => row._id.toHexString())
      .sort()
      .join(",");
    if (
      Object.keys(tally.totalVotes).sort().join(",") !== keys ||
      Object.keys(tally.candidateParties).sort().join(",") !== keys ||
      roster.some(
        (row) =>
          row.countryId !== "RU" ||
          !row.russianDumaNomination ||
          row.party !== tally.candidateParties[row._id.toHexString()] ||
          (row.isNPP && !row.nppId)
      )
    )
      throw new Error("The Duma tally does not match its frozen nominee roster");
    const againstAllVotes = tally.russianDumaBallot?.againstAllVotes ?? 0;
    for (const candidate of roster) registeredCandidateIds.add(candidate._id.toHexString());
    votesByElection[id] = { votes: { ...tally.totalVotes }, againstAllVotes };
    return {
      id,
      seatId: election.seatId!,
      regionId: election.state!,
      tier: election.russianDumaRound!.tier,
      registeredVoters: election.russianDumaRound!.registeredVoters,
      againstAllVotes,
      invalidated: tally.russianDumaBallot?.invalidated === true,
      candidates: roster.map((row) => {
        const ownerId = row.isNPP ? row.nppId! : row.characterId;
        const owner = owners.get(`${row.isNPP ? "npc" : "player"}:${ownerId.toHexString()}`);
        return {
          id: row._id.toHexString(),
          ownerId: ownerId.toHexString(),
          party: row.party,
          votes: tally.totalVotes[row._id.toHexString()],
          ...row.russianDumaNomination!,
          isNpc: !!row.isNPP,
          eligible:
            row.status === "active" &&
            (!!row.isNPP || !input.protectedDumaPlayerOwners?.has(ownerId.toHexString())) &&
            !councilOwners.has(`${row.isNPP ? "npc" : "player"}:${ownerId.toHexString()}`) &&
            owner?.compatible === true &&
            owner.party === row.party &&
            (!!row.isNPP ||
              election.russianDumaRound!.tier === "list" ||
              owner?.homeState === election.state),
        };
      }),
    };
  });
  return { ballots, counted, candidates, registeredCandidateIds, votesByElection };
}
