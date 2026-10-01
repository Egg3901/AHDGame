/**
 * Council certification retains frozen registration and previously counted withdrawals.
 * loadRussianCouncilCertificationInputs checks actual owners and pending Duma
 * mandates in bounded batches, preserving voter counts separately from nominee marks.
 */
import { type ClientSession, type Db } from "mongodb";
import type {
  Character,
  CountryGameState,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  NPP,
} from "@/lib/db/types";
import type { RussianCouncilCohortBallot } from "./rules/councilCohort";
import {
  RUSSIAN_DUMA_RESULTS_COLLECTION,
  type RussianDumaResultRecord,
} from "./dumaElectionResult";

import { russianDumaBoundRoot } from "./dumaConvocationAuthority";
export async function loadRussianCouncilCertificationInputs(input: {
  db: Db;
  session: ClientSession;
  cohort: readonly Election[];
  country: CountryGameState;
}) {
  const { db, session, cohort, country } = input;
  const electionIds = cohort.map((row) => row._id);
  const counted = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
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
          russianCouncilBallot: 1,
        },
      }
    )
    .toArray();
  if (
    counted.length !== cohort.length ||
    new Set(counted.map((row) => row.electionId.toHexString())).size !== cohort.length ||
    counted.some((row) => row.finalized || row.russianCouncilBallot?.certifiedCohortId)
  )
    throw new Error("Council certification needs one unique unfinalized tally per subject");
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
          russianCouncilNomination: 1,
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
  const pendingDuma = new Set<string>();
  const dumaRoot = russianDumaBoundRoot(country);
  if (dumaRoot) {
    const receipts = await db
      .collection<RussianDumaResultRecord>(RUSSIAN_DUMA_RESULTS_COLLECTION)
      .find(
        {
          countryId: "RU",
          preset: "1991-default",
          mandateSinceTurn: country.ruFederalAssemblyMandateSinceTurn,
          seatedOnTurn: { $exists: false },
          $or: [{ cohortId: dumaRoot }, { rootCohortId: dumaRoot }],
        },
        { session, projection: { result: 1, nominees: 1 } }
      )
      .toArray();
    for (const receipt of receipts) {
      for (const district of receipt.result.constituencyResults)
        if (district.winner)
          pendingDuma.add(`${district.winner.isNpc ? "npc" : "player"}:${district.winner.ownerId}`);
      for (const nominee of receipt.nominees)
        if (
          (receipt.result.listAssignment?.seatsByNominee[nominee.candidateId.toHexString()] ?? 0) >
          0
        )
          pendingDuma.add(`${nominee.isNpc ? "npc" : "player"}:${nominee.ownerId.toHexString()}`);
    }
  }
  const owners = new Map<string, { party: string; homeState?: string; eligibleOffice: boolean }>();
  for (const row of npcs) {
    const office =
      typeof row.currentOffice === "string" ? row.currentOffice : row.currentOffice?.type;
    owners.set(`npc:${row._id.toHexString()}`, {
      party: row.party,
      eligibleOffice:
        !office || office === "congressDeputy" || office === "federationCouncilMember",
    });
  }
  for (const row of players)
    owners.set(`player:${row._id.toHexString()}`, {
      party: row.party ?? "independent",
      homeState: row.homeState,
      eligibleOffice: !row.currentOffice || row.currentOffice.type === "congressDeputy",
    });
  const rosters = new Map<string, ElectionCandidate[]>();
  for (const row of candidates) {
    const id = row.electionId.toHexString();
    const roster = rosters.get(id) ?? [];
    roster.push(row);
    rosters.set(id, roster);
  }
  const tallyByElection = new Map(counted.map((row) => [row.electionId.toHexString(), row]));
  const registeredCandidateIds = new Set<string>();
  const ballots: RussianCouncilCohortBallot[] = cohort.map((election) => {
    const id = election._id.toHexString();
    const tally = tallyByElection.get(id)!;
    const ledger = tally.russianCouncilBallot;
    if (
      (!ledger && Object.values(tally.totalVotes).some((votes) => votes !== 0)) ||
      (ledger && ledger.registeredVoters !== election.russianCouncilRound!.registeredVoters)
    )
      throw new Error("Council marks need their original valid-ballot register");
    const roster = (rosters.get(id) ?? []).filter(
      (row) =>
        row.status === "active" ||
        Object.prototype.hasOwnProperty.call(
          ledger?.registrationOrderByCandidate ?? {},
          row._id.toHexString()
        )
    );
    const ids = new Set(roster.map((row) => row._id.toHexString()));
    if (
      Object.keys(tally.totalVotes).some((key) => !ids.has(key)) ||
      Object.keys(ledger?.registrationOrderByCandidate ?? {}).some((key) => !ids.has(key)) ||
      Object.keys(tally.candidateParties).some((key) => !ids.has(key)) ||
      roster.some(
        (row) =>
          row.countryId !== "RU" ||
          !row.russianCouncilNomination ||
          (row.isNPP && (!row.nppId || !row.nppId.equals(row.characterId))) ||
          (ledger &&
            ledger.registrationOrderByCandidate[row._id.toHexString()] !==
              row.russianCouncilNomination.registrationOrder) ||
          ((ledger || (tally.totalVotes[row._id.toHexString()] ?? 0) > 0) &&
            tally.candidateParties[row._id.toHexString()] !== row.party)
      )
    )
      throw new Error("Council tally does not match its frozen individual nominees");
    for (const row of roster) registeredCandidateIds.add(row._id.toHexString());
    return {
      id,
      seatId: election.seatId!,
      regionId: election.state,
      registeredVoters: election.russianCouncilRound!.registeredVoters,
      validBallots: ledger?.validBallots ?? 0,
      againstAllVotes: ledger?.againstAllVotes ?? 0,
      invalidated: ledger?.invalidated === true,
      candidates: roster.map((row) => {
        const ownerId = row.isNPP ? row.nppId! : row.characterId;
        const ownerKey = `${row.isNPP ? "npc" : "player"}:${ownerId.toHexString()}`;
        const owner = owners.get(ownerKey);
        return {
          id: row._id.toHexString(),
          ownerId: ownerId.toHexString(),
          party: row.party,
          isNpc: !!row.isNPP,
          votes: tally.totalVotes[row._id.toHexString()] ?? 0,
          registrationOrder: row.russianCouncilNomination!.registrationOrder,
          eligible:
            row.status === "active" &&
            owner?.party === row.party &&
            owner.eligibleOffice &&
            !pendingDuma.has(ownerKey) &&
            (!!row.isNPP || owner.homeState === election.state),
        };
      }),
    };
  });
  return { ballots, counted, candidates, registeredCandidateIds };
}
