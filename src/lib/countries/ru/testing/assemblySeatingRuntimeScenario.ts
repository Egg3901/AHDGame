import { ObjectId, type ClientSession, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { russianAssemblySeatingScenario } from "./assemblySeatingScenario";
import { resolveRussianDumaCohort } from "../rules/assemblyCohort";
import { resolveRussianCouncilCohort } from "../rules/councilCohort";
const session = { inTransaction: () => true } as ClientSession;
export function russianAssemblySeatingRuntimeScenario() {
  const mem = createInMemoryDb();
  const ballots = russianAssemblySeatingScenario();
  const ids = new Map<string, ObjectId>();
  const id = (key: string) => {
    if (!ids.has(key)) ids.set(key, new ObjectId());
    return ids.get(key)!;
  };
  for (const family of [ballots.duma, ballots.council]) {
    for (const ballot of family.ballots) {
      ballot.id = id(ballot.id).toHexString();
      for (const candidate of ballot.candidates) {
        candidate.id = id(candidate.id).toHexString();
        candidate.ownerId = id(candidate.ownerId).toHexString();
      }
    }
    for (const nominee of family.nominees) {
      nominee.candidateId = id(nominee.candidateId).toHexString();
      nominee.ownerId = id(nominee.ownerId).toHexString();
    }
  }
  const dumaRoot = new ObjectId(),
    councilRoot = new ObjectId();
  const base = {
    countryId: "RU",
    preset: "1991-default",
    mandateSinceTurn: 129,
    resolvedOnTurn: 141,
    createdAt: new Date(1000),
  };
  const nominees = (rows: typeof ballots.duma.nominees) =>
    rows.map((row) => ({
      ...row,
      candidateId: new ObjectId(row.candidateId),
      ownerId: new ObjectId(row.ownerId),
    }));
  mem.seed("gameState", [{ _id: "current", preset: "1991-default" }]);
  mem.seed("countryGameStates", [
    {
      _id: "RU",
      ruSovietSuccessionSinceTurn: 48,
      ruFederalAssemblyMandateSinceTurn: 129,
      ruFirstDumaElectionCohortId: dumaRoot,
      ruFirstCouncilElectionCohortId: councilRoot,
    },
  ]);
  mem.seed("russianDumaElectionResults", [
    {
      ...base,
      _id: dumaRoot.toHexString(),
      cohortId: dumaRoot,
      ballots: ballots.duma.ballots,
      nominees: nominees(ballots.duma.nominees),
      result: resolveRussianDumaCohort(ballots.duma.ballots),
    },
  ]);
  mem.seed("russianCouncilElectionResults", [
    {
      ...base,
      _id: councilRoot.toHexString(),
      cohortId: councilRoot,
      ballots: ballots.council.ballots,
      nominees: nominees(ballots.council.nominees),
      result: resolveRussianCouncilCohort(ballots.council.ballots),
    },
  ]);
  const owners = [
    ...new Set([...ballots.duma.nominees, ...ballots.council.nominees].map((row) => row.ownerId)),
  ];
  mem.seed(
    "npps",
    owners.map((ownerId) => ({
      _id: new ObjectId(ownerId),
      countryId: "RU",
      currentOffice: { type: "congressDeputy" },
      seatsHeld: 99,
      money: 500,
      personalAccount: { wealth: 12345, accounts: { USD: 12345, EUR: 200 } },
      retiredAt: null,
    }))
  );
  mem.seed("electedOfficials", [
    {
      _id: new ObjectId(),
      countryId: "RU",
      officeType: "congressDeputy",
      nppId: new ObjectId(owners[0]),
      characterId: null,
      seatsHeld: 1000,
    },
    {
      _id: new ObjectId(),
      countryId: "RU",
      officeType: "president",
      nppId: new ObjectId(),
      characterId: null,
    },
  ]);
  mem.seed(
    "states",
    [
      ...new Set(
        ballots.duma.ballots.filter((row) => row.tier === "constituency").map((row) => row.regionId)
      ),
    ].map((_id) => ({ _id, countryId: "RU", houseDistricts: 100, stateSenateSeats: 99 }))
  );
  mem.seed("elections", [
    ...ballots.duma.ballots.map((row) => ({
      _id: new ObjectId(row.id),
      countryId: "RU",
      status: "resolved",
      endTurn: 141,
      state: row.regionId,
      seatId: row.seatId,
      russianDumaRound: { cohortId: dumaRoot, registeredVoters: row.registeredVoters },
    })),
    ...ballots.council.ballots.map((row) => ({
      _id: new ObjectId(row.id),
      countryId: "RU",
      status: "resolved",
      endTurn: 141,
      state: row.regionId,
      seatId: row.seatId,
      russianCouncilRound: { cohortId: councilRoot, registeredVoters: row.registeredVoters },
    })),
  ]);
  mem.seed("governmentFormations", [
    {
      _id: "RU",
      governingPartyId: "1",
      coalitionPartyIds: ["1"],
      status: "formed",
      pmName: "Continuing PM",
    },
  ]);
  return {
    mem,
    dumaRoot,
    councilRoot,
    owners,
    input: { db: mem as unknown as Db, session, turn: 145, now: new Date(10000) },
  };
}
