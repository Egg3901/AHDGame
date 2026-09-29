import { describe, expect, it } from "vitest";
import { huRegions1991 } from "@/lib/countries/hu/data/huRegions1991";
import { buildHuMixedPlan, type HuRaceVotes } from "./mixedElectionPlan";
import { huDistrictIds } from "./constituencies2014";
import { accumulateHuBallots } from "./accumulateBallots2014";
import { allocateHuListTurnVotes } from "./listBallots2014";

const regions = huRegions1991.map((region) => ({
  id: String(region._id),
  population: region.population,
}));
const races: HuRaceVotes[] = regions.map((region, index) => ({
  electionId: `election-${region.id}`,
  regionId: region.id,
  candidates: [
    { candidateId: `a-${region.id}`, partyId: "a", votes: index < 3 ? 65_000 : 35_000 },
    { candidateId: `b-${region.id}`, partyId: "b", votes: index < 3 ? 35_000 : 65_000 },
  ],
}));

describe("live 2014 Hungary mixed election plan", () => {
  it("takes six NPP slates and separate second-vote streams through 106+93 seating", () => {
    const liveRaces = races.map((race) => {
      const ballot = accumulateHuBallots(
        race.regionId,
        race.candidates.map((candidate) => ({ ...candidate, isNPP: true })),
        allocateHuListTurnVotes(100_000, [
          { partyId: "a", registration: 40 },
          { partyId: "b", registration: 60 },
        ])
      );
      return { ...race, ...ballot };
    });
    const plan = buildHuMixedPlan(regions, liveRaces);
    expect(Object.keys(plan.result.constituencyWinners)).toHaveLength(106);
    expect(Object.values(plan.result.constituencySeats).reduce((a, b) => a + b, 0)).toBe(106);
    expect(Object.values(plan.result.listSeats).reduce((a, b) => a + b, 0)).toBe(93);
    expect(Object.values(plan.regionCapacity).reduce((a, b) => a + b, 0)).toBe(199);
    expect(
      liveRaces.every(
        (race) => Object.keys(race.districtSlate).length === huDistrictIds(race.regionId).length
      )
    ).toBe(true);
  });
  it("uses persisted district and list ballots when all six races have them", () => {
    const literal = races.map((race) => ({
      ...race,
      constituencyVotes: Object.fromEntries(
        huDistrictIds(race.regionId).map((districtId) => [
          districtId,
          { [race.candidates[0].candidateId]: 100, [race.candidates[1].candidateId]: 1 },
        ])
      ),
      listVotes: { a: 1, b: 1000 },
      districtSlate: Object.fromEntries(
        huDistrictIds(race.regionId).map((districtId) => [
          districtId,
          { a: race.candidates[0].candidateId, b: race.candidates[1].candidateId },
        ])
      ),
    }));
    const plan = buildHuMixedPlan(regions, literal);
    expect(plan.result.constituencySeats.a).toBe(106);
    expect(plan.result.listSeats.b).toBeGreaterThan(plan.result.listSeats.a ?? 0);
    const broken = literal.map((race, index) =>
      index === 0
        ? {
            ...race,
            districtSlate: {
              ...race.districtSlate,
              [huDistrictIds(race.regionId)[0]]: { a: race.candidates[1].candidateId },
            },
          }
        : race
    );
    expect(() => buildHuMixedPlan(regions, broken)).toThrow("invalid nominee");
  });
  it("turns six regional campaign tallies into 106 district ballots and 93 national list seats", () => {
    const plan = buildHuMixedPlan(regions, races);
    expect(Object.values(plan.result.constituencyWinners)).toHaveLength(106);
    expect(Object.values(plan.result.constituencySeats).reduce((a, b) => a + b, 0)).toBe(106);
    expect(Object.values(plan.result.listSeats).reduce((a, b) => a + b, 0)).toBe(93);
    expect(Object.values(plan.regionCapacity).reduce((a, b) => a + b, 0)).toBe(199);
    expect(
      Object.values(plan.candidateSeatsByElection)
        .flatMap(Object.values)
        .reduce((a, b) => a + b, 0)
    ).toBe(199);
    expect(
      plan.candidateSeatsByElection["election-" + regions[0].id]["a-" + regions[0].id]
    ).toBeGreaterThan(
      plan.candidateSeatsByElection["election-" + regions[0].id]["b-" + regions[0].id]
    );
    expect(buildHuMixedPlan(regions, races)).toEqual(plan);
  });

  it("rejects missing regional results before any seating decision", () => {
    expect(() => buildHuMixedPlan(regions, races.slice(1))).toThrow(
      "one completed race per region"
    );
  });

  it("lets an independent contest one district without inventing a national list", () => {
    const withIndependent = races.map((race, index) =>
      index === 0
        ? {
            ...race,
            candidates: [
              ...race.candidates,
              { candidateId: "independent-1", partyId: "independent", votes: 200_000 },
            ],
          }
        : race
    );
    const plan = buildHuMixedPlan(regions, withIndependent);
    expect(plan.result.listSeats.independent).toBeUndefined();
    expect(plan.result.listSeats["independent@independent-1"]).toBeUndefined();
    expect(plan.candidateSeatsByElection[races[0].electionId]["independent-1"]).toBeLessThanOrEqual(
      1
    );
    expect(Object.values(plan.regionCapacity).reduce((a, b) => a + b, 0)).toBe(199);
  });
});
