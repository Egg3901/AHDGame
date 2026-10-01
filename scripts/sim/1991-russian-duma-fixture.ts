/** Bounded first-Duma rules qualification with matched ballot preferences; no database. */
import {
  resolveRussianDumaList,
  resolveRussianDumaConstituency,
} from "../../src/lib/countries/ru/rules/assemblyResult";
import { allocateRussianDumaListMandates } from "../../src/lib/countries/ru/rules/assemblyList";
import { planRussianDumaDistricts } from "../../src/lib/countries/ru/rules/assemblyDistricts";
import { RU_1991_ECONOMIC_REGION_POPULATION } from "../../src/lib/countries/ru/data/ruPopulation1991";

const register = Object.fromEntries(
  Object.entries(RU_1991_ECONOMIC_REGION_POPULATION).map(([id, population]) => [
    id,
    Math.floor(population * 0.7),
  ])
);
const districts = planRussianDumaDistricts(register);
if (districts.length !== 225 || new Set(districts.map((row) => row.seatId)).size !== 225)
  throw new Error("District identity conservation failed");
for (const [id, voters] of Object.entries(register))
  if (
    districts
      .filter((row) => row.regionId === id)
      .reduce((sum, row) => sum + row.registeredVoters, 0) !== voters
  )
    throw new Error("Regional registration conservation failed");

const registeredVoters = 1_000_000;
const outcomes: Record<string, number> = {};
let scenarios = 0;
for (let seed = 1; seed <= 64; seed++) {
  const weights = Array.from(
    { length: 10 },
    (_, index) => ((((seed + index * 97) * 2654435761) >>> 0) % 100) + 1
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  for (const turnout of [0.24, 0.25, 0.5, 1]) {
    for (const againstAllShare of [0, 0.1, 0.9]) {
      const validBallots = Math.round(registeredVoters * turnout);
      const againstAllVotes = Math.round(validBallots * againstAllShare);
      const partyVotes = validBallots - againstAllVotes;
      const options = weights.map((weight, index) => ({
        id: `party-${index}`,
        votes: Math.floor((partyVotes * weight) / totalWeight),
        registrationOrder: index,
      }));
      options[0].votes += partyVotes - options.reduce((sum, row) => sum + row.votes, 0);
      const input = { registeredVoters, options, againstAllVotes };
      const result = resolveRussianDumaList(input);
      const reversed = resolveRussianDumaList({ ...input, options: [...options].reverse() });
      if (JSON.stringify(result.outcome) !== JSON.stringify(reversed.outcome))
        throw new Error("Input iteration order changed the outcome");
      if (result.outcome === "elected") {
        if (turnout < 0.25) throw new Error("Low valid-ballot turnout seated a list");
        if (Object.values(result.partySeats).reduce((sum, seats) => sum + seats, 0) !== 225)
          throw new Error("List mandate conservation failed");
        if (
          reversed.outcome !== "elected" ||
          options.some((row) => reversed.partySeats[row.id] !== result.partySeats[row.id])
        )
          throw new Error("Iteration order changed list mandates");
        for (const row of options)
          if (
            BigInt(row.votes) * BigInt(20) < BigInt(validBallots) &&
            result.partySeats[row.id] !== 0
          )
            throw new Error("A sub-threshold party received mandates");
        const nominees = options.flatMap((row, index) => [
          { id: `player-${index}`, party: row.id, order: 0, isNpc: false, capacity: 1 },
          { id: `slate-${index}`, party: row.id, order: 1, isNpc: true, capacity: 225 },
        ]);
        for (const constituencyWinner of [false, true]) {
          const assignment = allocateRussianDumaListMandates({
            partySeats: result.partySeats,
            nominees: nominees.map((row) => ({
              ...row,
              constituencyWinner: !row.isNpc && constituencyWinner,
            })),
          });
          if (
            Object.values(assignment.seatsByNominee).reduce((sum, seats) => sum + seats, 0) !== 225
          )
            throw new Error("Nominee assignment lost mandates");
          for (const row of nominees.filter((nominee) => !nominee.isNpc))
            if (assignment.seatsByNominee[row.id] > (constituencyWinner ? 0 : 1))
              throw new Error("A player received multiple legislative mandates");
        }
      } else if (turnout >= 0.25 && againstAllShare !== 0.9)
        throw new Error("A qualified list ballot unexpectedly repeated");
      const district = resolveRussianDumaConstituency(input);
      if ((district.outcome === "elected") !== turnout >= 0.25)
        throw new Error("Constituency valid-turnout rule failed");
      outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
      scenarios++;
    }
  }
}
console.log(
  JSON.stringify(
    {
      kind: "bounded-rules-matched-seed",
      scenarios,
      districts: districts.length,
      registeredVoters,
      outcomes,
      invariantChecks: [
        "regional voter conservation",
        "stable individual district identities",
        "25-percent valid-ballot quorum",
        "five-percent list gate",
        "exact 225 list mandates",
        "iteration-order independence",
        "one player mandate",
        "no list seat for constituency winners",
      ],
    },
    null,
    2
  )
);
