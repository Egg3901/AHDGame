import { describe, it, expect } from "vitest";
import type {
  State,
  StateDemographics,
  StateDemographicTurnout,
  StatePartyOrg,
} from "@/lib/db/types";
import { buildNationwideElectoratePreload } from "./nationwideElectorate";

function makeState(id: string, population: number, overrides: Partial<State> = {}): State {
  return {
    _id: id,
    countryId: "IE",
    name: id,
    population,
    votingEligiblePopulation: Math.round(population * 0.7),
    gdp: 100,
    houseDistricts: 3,
    stateSenateSeats: 2,
    region: "Leinster",
    votingSystem: "fptp",
    ...overrides,
  } as State;
}

function makeDemographics(
  id: string,
  groups: StateDemographics["groups"],
  categoryWeights: StateDemographics["categoryWeights"] = { class: 100 }
): StateDemographics {
  return {
    _id: id,
    countryId: "IE",
    categoryWeights,
    groups,
    lastUpdated: new Date("1953-01-01"),
  };
}

function makeTurnout(id: string, modifiers: StateDemographicTurnout["modifiers"]) {
  return {
    _id: id,
    countryId: "IE",
    modifiers,
    lastDecayApplied: new Date("1953-01-02"),
    lastUpdated: new Date("1953-01-03"),
  } as StateDemographicTurnout;
}

function makeOrg(
  stateId: string,
  partyId: string,
  overrides: Partial<StatePartyOrg> = {}
): StatePartyOrg {
  return {
    _id: `${stateId}_${partyId}`,
    countryId: "IE",
    stateId,
    partyId,
    organization: 50,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    treasury: 1000,
    stateTaxRate: 0.1,
    politicalStrength: 10,
    hasPresence: true,
    createdAt: new Date("1953-01-01"),
    updatedAt: new Date("1953-01-05"),
    ...overrides,
  } as StatePartyOrg;
}

// Two regions, 2:1 population split. Every weighted average below is checked
// against the hand-computed 2/3 vs 1/3 blend.
const bigState = makeState("IE-L", 2_000_000);
const smallState = makeState("IE-M", 1_000_000);
const otherCountryState = makeState("UK-X", 50_000_000, { countryId: "UK" } as Partial<State>);

const bigDemo = makeDemographics("IE-L", {
  workers: { population: 60, economicLean: -30, socialLean: 10, turnout: 60 },
  farmers: { population: 40, economicLean: 20, socialLean: 40 },
});
const smallDemo = makeDemographics("IE-M", {
  workers: { population: 30, economicLean: -60, socialLean: 20, turnout: 90 },
  clergy: { population: 70, economicLean: 10, socialLean: 80 },
});

describe("buildNationwideElectoratePreload", () => {
  it("returns null when the country has no states or no demographics", () => {
    expect(buildNationwideElectoratePreload("IE", [otherCountryState], [bigDemo], [], [])).toBe(
      null
    );
    expect(buildNationwideElectoratePreload("IE", [bigState], [], [], [])).toBe(null);
  });

  it("sums populations and ignores other countries' rows", () => {
    const preload = buildNationwideElectoratePreload(
      "IE",
      [bigState, smallState, otherCountryState],
      [bigDemo, smallDemo],
      [],
      []
    );
    expect(preload).not.toBeNull();
    expect(preload!.state._id).toBe("IE");
    expect(preload!.state.population).toBe(3_000_000);
    expect(preload!.state.votingEligiblePopulation).toBe(2_100_000);
    expect(preload!.state.gdp).toBe(200);
    expect(preload!.state.houseDistricts).toBe(6);
  });

  it("population-weights group leans by each group's absolute headcount", () => {
    const preload = buildNationwideElectoratePreload(
      "IE",
      [bigState, smallState],
      [bigDemo, smallDemo],
      [],
      []
    );
    const workers = preload!.demographics.groups.workers;
    // workers headcount: 2M*60% = 1.2M and 1M*30% = 0.3M => weights 0.8 / 0.2
    expect(workers.population).toBeCloseTo(50, 10); // 1.5M of 3M
    expect(workers.economicLean).toBeCloseTo(-30 * 0.8 + -60 * 0.2, 10);
    expect(workers.socialLean).toBeCloseTo(10 * 0.8 + 20 * 0.2, 10);
    expect(workers.turnout).toBeCloseTo(60 * 0.8 + 90 * 0.2, 10);
    // Group present in only one region keeps its own lean but a nationwide share.
    const clergy = preload!.demographics.groups.clergy;
    expect(clergy.population).toBeCloseTo((700_000 / 3_000_000) * 100, 10);
    expect(clergy.economicLean).toBe(10);
    // turnout was authored in neither clergy row, so it must stay absent.
    expect(clergy.turnout).toBeUndefined();
  });

  it("population-weights turnout modifiers across regions", () => {
    const preload = buildNationwideElectoratePreload(
      "IE",
      [bigState, smallState],
      [bigDemo, smallDemo],
      [
        makeTurnout("IE-L", { class: { workers: 1.2 } }),
        makeTurnout("IE-M", { class: { workers: 0.9 } }),
      ],
      []
    );
    // State-population weighted: 2/3 * 1.2 + 1/3 * 0.9
    expect(preload!.turnout.modifiers.class.workers).toBeCloseTo(1.1, 10);
    expect(preload!.turnout.lastUpdated).toEqual(new Date("1953-01-03"));
    expect(preload!.turnout.lastDecayApplied).toEqual(new Date("1953-01-02"));
  });

  it("folds party orgs into one national row per party", () => {
    const preload = buildNationwideElectoratePreload(
      "IE",
      [bigState, smallState],
      [bigDemo, smallDemo],
      [],
      [
        makeOrg("IE-L", "1", { organization: 90, treasury: 300, politicalStrength: 30 }),
        makeOrg("IE-M", "1", { organization: 30, treasury: 100, politicalStrength: 6 }),
        makeOrg("IE-M", "2", { organization: 40, hasPresence: false }),
      ]
    );
    expect(preload!.partyOrgs).toHaveLength(2);
    const fine = preload!.partyOrgs.find((o) => o.partyId === "1")!;
    expect(fine._id).toBe("IE_1");
    expect(fine.stateId).toBe("IE");
    expect(fine.organization).toBeCloseTo(90 * (2 / 3) + 30 * (1 / 3), 10);
    expect(fine.treasury).toBe(400);
    expect(fine.politicalStrength).toBeCloseTo(22, 10);
    expect(fine.hasPresence).toBe(true);
    const minor = preload!.partyOrgs.find((o) => o.partyId === "2")!;
    expect(minor.organization).toBe(40);
    expect(minor.hasPresence).toBe(false);
  });

  it("survives regions with zero population without dividing by them", () => {
    const ghost = makeState("IE-G", 0);
    const preload = buildNationwideElectoratePreload(
      "IE",
      [bigState, ghost],
      [
        bigDemo,
        makeDemographics("IE-G", {
          workers: { population: 100, economicLean: 99, socialLean: 99 },
        }),
      ],
      [],
      []
    );
    // Zero-population region contributes no group weight, so leans are the
    // big state's alone.
    expect(preload!.demographics.groups.workers.economicLean).toBe(-30);
  });
});
