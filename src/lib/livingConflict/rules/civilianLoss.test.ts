import { describe, expect, it } from "vitest";
import { totalPopulation } from "@/lib/demographics/cohortVector";
import {
  planConflictCivilianLosses,
  type ConflictCivilianLossOrder,
  type ConflictCivilianLossRegion,
} from "./civilianLoss";
import { planRefugeeReceptions, type RefugeeReceptionOrder } from "./refugeeReception";

const order: ConflictCivilianLossOrder = {
  _id: "order",
  worldEpochId: "world",
  interactionId: "interaction",
  crisisId: "crisis",
  outcomeId: "escalation",
  countryId: "YU",
  regionIds: ["origin"],
  effectiveTurn: 8,
  requestedPeople: 20,
  status: "pending",
};
function region(regionId = "origin", countryId = "YU"): ConflictCivilianLossRegion {
  const male = Array<number>(101).fill(0);
  const female = [...male];
  male[20] = 100;
  female[60] = 100;
  return { regionId, countryId, vector: { male, female } };
}

describe("explicit civilian mortality", () => {
  it("removes exactly named civilian deaths, preserves age/sex shares and never mutates inputs", () => {
    const input = region();
    const baseline = structuredClone(input);
    const result = planConflictCivilianLosses([order], [input, region("host", "AT")], 8, "world");
    expect(result.results[0]).toMatchObject({
      stock: "civilian-residents",
      deaths: 20,
      regions: [{ regionId: "origin", deaths: 20 }],
    });
    expect(result.regions.find((r) => r.regionId === "origin")?.vector.male[20]).toBe(90);
    expect(totalPopulation(result.regions.find((r) => r.regionId === "host")!.vector)).toBe(200);
    expect(input).toEqual(baseline);
    expect(result.deathsByRegion).toEqual({ origin: 20 });
  });
  it("reserves serving age/sex cells and leaves actual military units outside this rule", () => {
    const input = region();
    const serving = Array<number>(101).fill(0);
    serving[20] = 100;
    input.servingMaleByAge = serving;
    const result = planConflictCivilianLosses([order], [input], 8, "world");
    expect(result.regions[0].vector.male[20]).toBe(100);
    expect(result.regions[0].vector.female[60]).toBe(80);
  });
  it("bounds competing requests by remaining civilians and preserves the population floor", () => {
    const result = planConflictCivilianLosses(
      [
        { ...order, requestedPeople: 500 },
        { ...order, _id: "z", requestedPeople: 500 },
      ],
      [region()],
      8,
      "world"
    );
    expect(result.results.map((r) => r.deaths)).toEqual([199, 0]);
    expect(totalPopulation(result.regions[0].vector)).toBeCloseTo(1);
    expect(result.results[1].reason).toBe("no-available-civilians");
  });
  it("uses frozen territory and current sovereignty, without charging newly acquired regions or successors", () => {
    const result = planConflictCivilianLosses(
      [order],
      [region("origin", "HR"), region("new-YU", "YU")],
      8,
      "world"
    );
    expect(result.results[0]).toMatchObject({ deaths: 0, reason: "no-sovereign-region" });
    expect(result.regions.map((r) => totalPopulation(r.vector))).toEqual([200, 200]);
  });
  it("skips future and completed orders and fails closed for another world, duplicates and invalid stocks", () => {
    expect(
      planConflictCivilianLosses(
        [
          { ...order, effectiveTurn: 9 },
          { ...order, _id: "done", status: "complete" },
        ],
        [region()],
        8,
        "world"
      ).results
    ).toEqual([]);
    expect(() => planConflictCivilianLosses([order], [region()], 8, "other")).toThrow(
      "another world"
    );
    expect(() => planConflictCivilianLosses([order, order], [region()], 8, "world")).toThrow(
      "Duplicate"
    );
    expect(() =>
      planConflictCivilianLosses([{ ...order, requestedPeople: NaN }], [region()], 8, "world")
    ).toThrow("Invalid");
    const bad = region();
    bad.vector.male[20] = -1;
    expect(() => planConflictCivilianLosses([order], [bad], 8, "world")).toThrow("Invalid");
  });
  it("keeps results deterministic across input order and shares reduced stock with refugee reception", () => {
    const regions = [region(), region("second"), region("host", "AT")];
    const orders = [
      { ...order, regionIds: ["origin", "second"] },
      { ...order, _id: "z", regionIds: ["origin", "second"] },
    ];
    const losses = planConflictCivilianLosses(orders, regions, 8, "world");
    expect(
      planConflictCivilianLosses([...orders].reverse(), [...regions].reverse(), 8, "world")
    ).toEqual(losses);
    const reception: RefugeeReceptionOrder = {
      _id: "reception",
      worldEpochId: "world",
      interactionId: "interaction",
      crisisId: "crisis",
      nodeId: "node",
      optionId: "receive",
      originCountryId: "YU",
      destinationCountryId: "AT",
      effectiveTurn: 8,
      expiresTurn: 32,
      requestedPeople: 1000,
      annualServiceCostPerPerson: 1,
      serviceDurationTurns: 24,
      authorization: {
        basis: "humanitarian-response",
        admissionMultiplier: 1,
        laws: [],
        displacementActive: true,
      },
      status: "pending",
    };
    const received = planRefugeeReceptions(
      [reception],
      losses.regions.map((r) => ({ ...r, remainingMigrationCapacity: 1000 })),
      8,
      "world"
    );
    expect(received.results[0].movedPeople).toBeCloseTo(360);
    expect(received.regions.reduce((sum, r) => sum + totalPopulation(r.vector), 0)).toBeCloseTo(
      560
    );
  });
});
