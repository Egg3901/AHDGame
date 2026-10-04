import { describe, expect, it } from "vitest";
import type { AgeSexVector } from "@/lib/demographics/cohortVector";
import { totalPopulation } from "@/lib/demographics/cohortVector";
import {
  planRefugeeReceptions,
  refugeeAdmissionAuthorization,
  refugeeServiceCostsByCountry,
  servingCohortsForReception,
  type RefugeeReceptionOrder,
  type RefugeeRegion,
} from "./refugeeReception";

function vector(male = 600, female = 400): AgeSexVector {
  const ages = { male: Array<number>(101).fill(0), female: Array<number>(101).fill(0) };
  ages.male[20] = male;
  ages.female[10] = female;
  return ages;
}
function order(overrides: Partial<RefugeeReceptionOrder> = {}): RefugeeReceptionOrder {
  return {
    _id: "order-1",
    worldEpochId: "world",
    interactionId: "interaction",
    crisisId: "crisis",
    nodeId: "neighbor",
    optionId: "receive_refugees",
    originCountryId: "origin",
    destinationCountryId: "host",
    effectiveTurn: 8,
    expiresTurn: 32,
    requestedPeople: 100,
    annualServiceCostPerPerson: 2000,
    serviceDurationTurns: 24,
    authorization: refugeeAdmissionAuthorization([]),
    status: "pending",
    ...overrides,
  };
}
function regions(cap = 100): RefugeeRegion[] {
  return [
    {
      regionId: "origin-region",
      countryId: "origin",
      vector: vector(),
      remainingMigrationCapacity: cap,
    },
    {
      regionId: "host-region",
      countryId: "host",
      vector: vector(),
      remainingMigrationCapacity: cap,
    },
  ];
}

describe("conserved humanitarian reception", () => {
  it("moves the same male and female cells and prices only actual arrivals", () => {
    const input = regions();
    const result = planRefugeeReceptions([order()], input, 8, "world");
    expect(result.results[0]).toMatchObject({
      movedPeople: 100,
      annualServiceCost: 200_000,
      appliedTurn: 8,
      serviceEndTurn: 32,
      reason: "received",
    });
    expect(result.results[0].routes[0]).toMatchObject({
      originRegionId: "origin-region",
      destinationRegionId: "host-region",
      people: 100,
    });
    for (const sex of ["male", "female"] as const)
      for (let age = 0; age <= 100; age++)
        expect(
          result.regions.reduce((sum, region) => sum + region.vector[sex][age], 0)
        ).toBeCloseTo(
          input.reduce((sum, region) => sum + region.vector[sex][age], 0),
          10
        );
    expect(totalPopulation(input[0].vector)).toBe(1000);
    expect(result.netByRegion).toEqual({ "origin-region": -100, "host-region": 100 });
  });
  it("uses residual migration capacity after routine migration", () => {
    const result = planRefugeeReceptions([order()], regions(15), 8, "world");
    expect(result.results[0].movedPeople).toBeCloseTo(15);
    expect(result.results[0].annualServiceCost).toBeCloseTo(30_000);
  });
  it("protects serving cohorts and clamps requests to remaining civilian stock", () => {
    const input = regions(5000);
    input[0].servingMaleByAge = vector(600, 0).male;
    const result = planRefugeeReceptions([order({ requestedPeople: 5000 })], input, 8, "world");
    expect(result.results[0].movedPeople).toBe(400);
    expect(
      result.regions.find((region) => region.regionId === "origin-region")?.vector.male[20]
    ).toBe(600);
  });
  it("shares source capacity between simultaneous hosts in stable order", () => {
    const input = [
      ...regions(100),
      {
        regionId: "other-host",
        countryId: "other",
        vector: vector(),
        remainingMigrationCapacity: 100,
      },
    ];
    const orders = [order({ _id: "b", destinationCountryId: "other" }), order({ _id: "a" })];
    const forward = planRefugeeReceptions(orders, input, 8, "world");
    expect(forward).toEqual(
      planRefugeeReceptions([...orders].reverse(), [...input].reverse(), 8, "world")
    );
    expect(forward.results.map((result) => result.movedPeople)).toEqual([100, 0]);
  });
  it("never substitutes a retired origin's successor without new sovereign authorization", () => {
    const input = regions();
    input[0].countryId = "successor";
    expect(planRefugeeReceptions([order()], input, 8, "world").results[0]).toMatchObject({
      movedPeople: 0,
      annualServiceCost: 0,
      routes: [],
      reason: "no-modeled-route",
    });
  });
  it("does not process completed or future choices", () => {
    expect(
      planRefugeeReceptions(
        [order({ status: "complete" }), order({ _id: "future", effectiveTurn: 9 })],
        regions(),
        8,
        "world"
      ).results
    ).toEqual([]);
  });
  it("rejects duplicate orders, negative cohorts and other-world orders", () => {
    expect(() => planRefugeeReceptions([order(), order()], regions(), 8, "world")).toThrow(
      "unique"
    );
    const bad = regions();
    bad[0].vector.male[20] = -1;
    expect(() => planRefugeeReceptions([order()], bad, 8, "world")).toThrow("non-negative");
    expect(() =>
      planRefugeeReceptions([order({ worldEpochId: "old" })], regions(), 8, "world")
    ).toThrow("another world");
  });
  it("reserves the sex-specific modeled conscript totals within their actual age band", () => {
    const reserved = servingCohortsForReception(vector(), [18, 20], 120, 0);
    expect(reserved.male[20]).toBe(120);
    expect(totalPopulation(reserved)).toBe(120);
    expect(reserved.female[10]).toBe(0);
  });
});

describe("enacted asylum authorization and service obligations", () => {
  it("does not revive an expired corridor or move people without displacement", () => {
    const expired = planRefugeeReceptions([order()], regions(), 32, "world").results[0];
    expect(expired).toMatchObject({
      movedPeople: 0,
      annualServiceCost: 0,
      reason: "authorization-expired",
    });
    const inactive = order({
      authorization: { ...refugeeAdmissionAuthorization([]), displacementActive: false },
    });
    expect(planRefugeeReceptions([inactive], regions(), 8, "world").results[0]).toMatchObject({
      movedPeople: 0,
      annualServiceCost: 0,
      reason: "no-displacement",
    });
  });
  it("uses the latest enacted law and keeps the most restrictive active type", () => {
    const auth = refugeeAdmissionAuthorization([
      { legislationTypeId: "de_asylum_policy", policyOptionIndex: 6, enactedAt: 1 },
      { legislationTypeId: "de_asylum_policy", policyOptionIndex: 0, enactedAt: 2 },
      { legislationTypeId: "de_immigration_policy", policyOptionIndex: 4, enactedAt: 3 },
    ]);
    expect(auth.admissionMultiplier).toBe(0.25);
    expect(auth.laws).toHaveLength(2);
    expect(
      planRefugeeReceptions([order({ authorization: auth })], regions(), 8, "world").results[0]
        .movedPeople
    ).toBe(25);
  });
  it("a closed law moves nobody and creates no service obligation", () => {
    const authorization = refugeeAdmissionAuthorization([
      { legislationTypeId: "uk_immigration_asylum", policyOptionIndex: 6, enactedAt: 1 },
    ]);
    expect(
      planRefugeeReceptions([order({ authorization })], regions(), 8, "world").results[0]
    ).toMatchObject({ movedPeople: 0, annualServiceCost: 0, reason: "closed-by-law" });
  });
  it("does not treat an unrelated law as border permission and rejects unknown asylum options", () => {
    expect(
      refugeeAdmissionAuthorization([{ legislationTypeId: "health", enactedAt: 1 }])
        .admissionMultiplier
    ).toBe(1);
    expect(() =>
      refugeeAdmissionAuthorization([{ legislationTypeId: "de_asylum_policy", enactedAt: 1 }])
    ).toThrow("valid enacted option");
  });
  it("books exactly 24 turns of support, including the arrival turn, without replay accumulation", () => {
    const reception = planRefugeeReceptions([order()], regions(), 8, "world").results[0];
    let paid = 0;
    for (let turn = 1; turn <= 40; turn++) {
      const cost = refugeeServiceCostsByCountry([reception], "world", turn).host ?? 0;
      expect(refugeeServiceCostsByCountry([reception], "world", turn).host ?? 0).toBe(cost);
      paid += cost / 48;
    }
    expect(paid).toBeCloseTo(100_000);
    expect(refugeeServiceCostsByCountry([reception], "world", 7)).toEqual({});
    expect(refugeeServiceCostsByCountry([reception], "world", 32)).toEqual({});
    expect(refugeeServiceCostsByCountry([reception], "new-world", 8)).toEqual({});
    expect(() => refugeeServiceCostsByCountry([reception, reception], "world", 8)).toThrow(
      "Duplicate"
    );
  });
});
