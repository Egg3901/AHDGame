import { describe, expect, it } from "vitest";
import { countHuModernByElection } from "./constituencyByElection2011";
const districts = Array.from({ length: 106 }, (_, i) => `district:${i + 1}`);
const ballot = {
  districtId: districts[0],
  registeredVoters: 1000,
  candidates: [
    { personId: "a", votes: 3 },
    { personId: "b", votes: 2 },
  ],
};
describe("modern Hungarian constituency vacancy ballots", () => {
  it("elects a plurality without the old majority or turnout barrier", () => {
    expect(countHuModernByElection(districts, [districts[0]], [ballot])).toEqual({
      winners: { [districts[0]]: "a" },
      vacancies: [],
    });
  });
  it.each([
    [2, 2],
    [0, 0],
  ])("leaves tied or empty ballots vacant (%i/%i)", (a, b) => {
    expect(
      countHuModernByElection(
        districts,
        [districts[0]],
        [
          {
            ...ballot,
            candidates: [
              { personId: "a", votes: a },
              { personId: "b", votes: b },
            ],
          },
        ]
      )
    ).toEqual({ winners: { [districts[0]]: null }, vacancies: [districts[0]] });
  });
  it("requires the current106-district chamber and exact vacancy coverage", () => {
    expect(() => countHuModernByElection(districts.slice(1), [districts[0]], [ballot])).toThrow();
    expect(() => countHuModernByElection(districts, ["old176"], [ballot])).toThrow();
    expect(() =>
      countHuModernByElection(districts, [districts[0], districts[1]], [ballot])
    ).toThrow();
    expect(() =>
      countHuModernByElection(districts, [districts[0], districts[0]], [ballot])
    ).toThrow();
  });
  it("rejects duplicate people across constituency ballots", () => {
    expect(() =>
      countHuModernByElection(districts, districts.slice(0, 2), [
        ballot,
        { ...ballot, districtId: districts[1] },
      ])
    ).toThrow("duplicate people");
  });
  it.each([-1, 1.5, NaN, 1001])("rejects malformed or excessive votes (%s)", (votes) => {
    expect(() =>
      countHuModernByElection(
        districts,
        [districts[0]],
        [{ ...ballot, candidates: [{ personId: "a", votes }] }]
      )
    ).toThrow();
  });
  it.each([0, 1.5, NaN])("rejects an invalid frozen register (%s)", (registeredVoters) => {
    expect(() =>
      countHuModernByElection(districts, [districts[0]], [{ ...ballot, registeredVoters }])
    ).toThrow("frozen register");
  });
});
