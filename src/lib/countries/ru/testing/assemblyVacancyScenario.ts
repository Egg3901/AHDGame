import { resolveRussianCouncilRepeat } from "../rules/councilRepeat";
import { ObjectId } from "mongodb";
import { russianAssemblySeatingRuntimeScenario } from "./assemblySeatingRuntimeScenario";
import type { RussianDumaResultRecord } from "../dumaElectionResult";
import type { RussianCouncilResultRecord } from "../councilElectionResult";
import {
  resolveRussianDumaCohort,
  resolveRussianDumaRepeatGeneration,
} from "../rules/assemblyCohort";
import { resolveRussianCouncilCohort } from "../rules/councilCohort";
export function russianAssemblyVacancyScenario(
  kind: "protected-player" | "council-repeat" | "list-transfer"
) {
  const fixture = russianAssemblySeatingRuntimeScenario();
  const { mem, dumaRoot, councilRoot } = fixture;
  const duma = mem.collection("russianDumaElectionResults")
    .docs[0] as unknown as RussianDumaResultRecord;
  const council = mem.collection("russianCouncilElectionResults")
    .docs[0] as unknown as RussianCouncilResultRecord;
  const playerId = new ObjectId();
  const character = {
    _id: playerId,
    countryId: "RU",
    party: "1",
    homeState: duma.ballots![0].regionId,
    currentOffice: null,
    money: 700,
    ...(kind === "protected-player" ? { federationPendingResidenceId: "protected-choice" } : {}),
  };
  if (kind !== "council-repeat") mem.seed("characters", [character]);
  if (kind === "protected-player") {
    const winner = duma.ballots![0].candidates[0];
    winner.ownerId = playerId.toHexString();
    winner.isNpc = false;
    const nominee = duma.nominees.find((row) => row.candidateId.toHexString() === winner.id)!;
    nominee.ownerId = playerId;
    nominee.isNpc = false;
    duma.result = resolveRussianDumaCohort(duma.ballots!);
  } else if (kind === "list-transfer") {
    for (const row of duma.ballots![0].candidates) row.votes = 0;
    const list = duma.ballots!.find((row) => row.tier === "list")!;
    const candidate = {
      ...list.candidates[0],
      id: new ObjectId().toHexString(),
      ownerId: playerId.toHexString(),
      isNpc: false,
      capacity: 1,
      votes: 0,
      registrationOrder: 0,
      nominationOrder: 0,
    };
    for (const row of list.candidates) {
      row.registrationOrder++;
      row.nominationOrder++;
    }
    list.candidates = [...list.candidates, candidate];
    duma.nominees.push({
      candidateId: new ObjectId(candidate.id),
      ownerId: playerId,
      isNpc: false,
      name: "Synthetic deputy",
      party: "1",
    });
    duma.result = resolveRussianDumaCohort(duma.ballots!);
  } else {
    council.ballots[0].validBallots = 0;
    for (const row of council.ballots[0].candidates) row.votes = 0;
    council.result = resolveRussianCouncilCohort(council.ballots);
  }
  const installRepeat = () => {
    const cohortId = new ObjectId(),
      pollId = new ObjectId(),
      candidateId = new ObjectId();
    if (kind === "council-repeat") {
      const ballot = {
        ...council.ballots[0],
        id: pollId.toHexString(),
        validBallots: 1000,
        candidates: council.ballots[0].candidates.map((row, index) => ({
          ...row,
          id: new ObjectId().toHexString(),
          votes: [600, 500, 400][index],
        })),
      };
      const combined = resolveRussianCouncilRepeat({
        previous: council.ballots,
        replacements: [ballot],
      });
      const receipt = {
        ...council,
        _id: cohortId.toHexString(),
        cohortId,
        rootCohortId: councilRoot,
        generation: 1,
        resolvedOnTurn: 160,
        ballots: combined.ballots,
        result: combined.result,
        nominees: [
          ...council.nominees.filter(
            (row) =>
              !council.ballots[0].candidates.some((old) => old.id === row.candidateId.toHexString())
          ),
          ...ballot.candidates.map((row) => ({
            candidateId: new ObjectId(row.id),
            ownerId: new ObjectId(row.ownerId),
            isNpc: true,
            name: "Repeat nominee",
            party: row.party,
          })),
        ],
      };
      delete receipt.seatedOnTurn;
      mem.collection("russianCouncilElectionResults").docs.unshift(receipt);
      mem.collection("elections").docs.push({
        _id: pollId,
        countryId: "RU",
        status: "resolved",
        endTurn: 160,
        state: ballot.regionId,
        seatId: ballot.seatId,
        russianCouncilRound: {
          cohortId,
          rootCohortId: councilRoot,
          generation: 1,
          registeredVoters: ballot.registeredVoters,
        },
      });
      return receipt;
    }
    const old = duma.ballots![0];
    const ballot = {
      ...old,
      id: pollId.toHexString(),
      candidates: [
        {
          ...old.candidates[0],
          id: candidateId.toHexString(),
          ownerId: playerId.toHexString(),
          isNpc: false,
          votes: Math.ceil(old.registeredVoters * 0.6),
        },
      ],
    };
    const combined = resolveRussianDumaRepeatGeneration({
      previousBallots: duma.ballots!,
      replacements: [ballot],
    });
    const receipt = {
      ...duma,
      _id: cohortId.toHexString(),
      cohortId,
      rootCohortId: dumaRoot,
      generation: 1,
      resolvedOnTurn: 160,
      ballots: combined.ballots,
      result: combined.result,
      nominees: [
        ...duma.nominees.filter(
          (row) =>
            !old.candidates.some((candidate) => candidate.id === row.candidateId.toHexString())
        ),
        { candidateId, ownerId: playerId, isNpc: false, name: "Synthetic deputy", party: "1" },
      ],
    };
    delete receipt.seatedOnTurn;
    mem.collection("russianDumaElectionResults").docs.unshift(receipt);
    mem.collection("elections").docs.push({
      _id: pollId,
      countryId: "RU",
      status: "resolved",
      endTurn: 160,
      state: ballot.regionId,
      seatId: ballot.seatId,
      russianDumaRound: {
        cohortId,
        rootCohortId: dumaRoot,
        generation: 1,
        registeredVoters: ballot.registeredVoters,
      },
    });
    return receipt;
  };
  return { ...fixture, playerId, installRepeat };
}
