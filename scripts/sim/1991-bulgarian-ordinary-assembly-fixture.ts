/** Portable bounded sweep; no server, Mongo or production world is required. */
import {
  buildBgOrdinaryElectionPlan,
  type BgOrdinaryRace,
} from "../../src/lib/countries/bg/rules/ordinaryElectionPlan";
import { BG_1991_MACROREGION_POPULATION } from "../../src/lib/countries/bg/data/bgPopulation1991";
let allocated = 0,
  deferred = 0,
  mandates = 0,
  playerMandates = 0;
for (let seed = 0; seed < 64; seed++) {
  const races: BgOrdinaryRace[] = Object.entries(BG_1991_MACROREGION_POPULATION).map(
    ([regionId, population], index) => ({
      electionId: `${seed}:${regionId}`,
      regionId,
      candidates: ["A", "B", "C"].map((party, order) => ({
        id: `${regionId}:${party}`,
        ownerId: `existing:${regionId}:${party}`,
        party,
        votes: Math.round(
          population *
            (order === 0 ? 0.42 + (seed % 17) / 100 : order === 1 ? 0.54 - (seed % 17) / 100 : 0.03)
        ),
        listOrder: order,
        isNpc: true,
        eligible: !(seed % 8 === 0 && index === 0 && party === "A"),
      })),
    })
  );
  races[0].candidates = [
    {
      ...races[0].candidates[0],
      id: "player",
      ownerId: "human",
      isNpc: false,
      votes: 1,
      listOrder: -1,
    },
    ...races[0].candidates,
  ];
  const result = buildBgOrdinaryElectionPlan(races);
  if (result.kind === "deferred") {
    deferred++;
    continue;
  }
  const seats = Object.values(result.candidateSeatsByElection)
    .flatMap(Object.values)
    .reduce((sum, n) => sum + n, 0);
  if (seats !== 240 || Object.keys(result.districtSeats).length !== 31)
    throw new Error("Bulgarian mandate conservation failed");
  const humanSeats = result.candidateSeatsByElection[races[0].electionId].player;
  if (humanSeats !== 1) throw new Error("Player received more or fewer than one mandate");
  if (JSON.stringify(buildBgOrdinaryElectionPlan([...races].reverse())) !== JSON.stringify(result))
    throw new Error("Bulgarian input order changed the national count");
  allocated++;
  mandates += seats;
  playerMandates += humanSeats;
}
console.log(
  JSON.stringify(
    {
      scenarios: 64,
      allocated,
      deferred,
      mandates,
      playerMandates,
      npcProfilesCreated: 0,
      scope:
        "Portable bounded 31-district counting scenarios, not a full-world or production qualification",
    },
    null,
    2
  )
);
