import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Bill, BillWhip, LegislationType, NPP, StateDemographics } from "@/lib/db/types";
import {
  computeCrossPressureForces,
  computeDistrictForce,
  computeDonorsForce,
  computeIdeologyForce,
  computePartyLineForce,
  computeWhipForce,
  verdictFromForces,
} from "./crossPressure";

function makeNPP(overrides: Partial<NPP> = {}): NPP {
  return {
    _id: new ObjectId(),
    name: "Test NPP",
    homeState: "OH",
    party: "1",
    politicalInfluence: 50,
    favorability: 50,
    policies: { economic: 0, social: 0, domainPositions: {} },
    currentOffice: null,
    personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
    generatedAt: new Date(),
    retiredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    donorBaseLevel: 0,
    ...overrides,
  };
}

function makeBill(overrides: Partial<Bill> = {}): Bill {
  return {
    _id: new ObjectId(),
    title: "Test Bill",
    summary: "",
    status: "active",
    originChamber: "house",
    currentChamber: "house",
    sponsorId: null,
    sponsorName: "Sponsor",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    proposedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Bill;
}

function makeWhip(direction: "for" | "against", mode?: "soft" | "hard"): BillWhip {
  return {
    _id: new ObjectId(),
    targetType: "bill",
    targetId: new ObjectId(),
    chamber: "house",
    direction,
    mode,
    issuedBy: "nationalParty",
    countryId: "US",
    partyId: "1",
    audience: "npp",
    attemptNumber: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeTaxType(): LegislationType {
  return {
    _id: "tax-policy",
    name: "Tax Policy",
    description: "",
    policyDomain: "economic",
    subCategory: "tax",
    positions: [],
    policyOptions: [
      {
        id: "raise-taxes",
        name: "Raise taxes",
        stance: "left",
        effectDirection: 1,
        economic: -3,
        social: 0,
        archetypeApprovals: {
          rural_workers: -40,
          urban_professionals: 30,
        },
      },
    ],
  };
}

describe("computeIdeologyForce", () => {
  it("returns 0 when bill has no policy provision and no top-level legislation type", () => {
    const npp = makeNPP();
    const bill = makeBill();
    expect(computeIdeologyForce(npp, bill)).toBe(0);
  });

  it("supports a left-coded option even when effectDirection is positive", () => {
    const npp = makeNPP({
      policies: { economic: -2, social: -2, domainPositions: {} },
    });
    const bill = makeBill({
      provisions: [
        {
          type: "policy",
          legislationTypeId: "clean-energy",
          policyOptionId: "green-new-deal",
          effectDirection: 1,
          economic: -3,
          social: -3,
        },
      ],
    });

    expect(computeIdeologyForce(npp, bill)).toBeGreaterThan(50);
  });

  it("opposes a left-coded option for a right-leaning NPP", () => {
    const npp = makeNPP({
      policies: { economic: 2, social: 2, domainPositions: {} },
    });
    const bill = makeBill({
      provisions: [
        {
          type: "policy",
          legislationTypeId: "clean-energy",
          policyOptionId: "green-new-deal",
          effectDirection: 1,
          economic: -3,
          social: -3,
        },
      ],
    });

    expect(computeIdeologyForce(npp, bill)).toBeLessThan(-50);
  });

  it("supports a right-coded option even when effectDirection is negative", () => {
    const npp = makeNPP({
      policies: { economic: 2, social: 2, domainPositions: {} },
    });
    const bill = makeBill({
      provisions: [
        {
          type: "policy",
          legislationTypeId: "justice",
          policyOptionId: "punitive",
          effectDirection: -1,
          economic: 3,
          social: 3,
        },
      ],
    });

    expect(computeIdeologyForce(npp, bill)).toBeGreaterThan(50);
  });

  it("uses the selected policy option vector when a provision has no frozen vector", () => {
    const npp = makeNPP({
      policies: { economic: -2, social: 0, domainPositions: {} },
    });
    const bill = makeBill({
      provisions: [
        {
          type: "policy",
          legislationTypeId: "tax-policy",
          policyOptionId: "raise-taxes",
          effectDirection: 1,
        },
      ],
    });

    expect(computeIdeologyForce(npp, bill, makeTaxType())).toBe(40);
  });

  it("keeps legacy domain stance fallback for top-level bills", () => {
    const npp = makeNPP({
      policies: { economic: 0, social: 0, domainPositions: { "tax-policy": 5 } },
    });
    const bill = makeBill({ legislationTypeId: "tax-policy", effectDirection: 1 });

    expect(computeIdeologyForce(npp, bill)).toBe(100);
  });

  it("uses a left-friendly legacy economic fallback when no domain stance exists", () => {
    const npp = makeNPP({
      policies: { economic: -4, social: 0, domainPositions: {} },
    });
    const bill = makeBill({ legislationTypeId: "tax-policy", effectDirection: 1 });

    expect(computeIdeologyForce(npp, bill)).toBe(80);
  });
});

describe("computeWhipForce", () => {
  it("returns 0 when no whips are present", () => {
    const npp = makeNPP();
    expect(computeWhipForce(npp, { partyWhip: null, caucusWhip: null })).toBe(0);
  });

  it("returns base party-whip pull gated by full compliance for a fully loyal NPP", () => {
    const npp = makeNPP({ personality: { loyalty: 100, ambition: 50, stubbornness: 0 } });
    const result = computeWhipForce(npp, { partyWhip: makeWhip("for"), caucusWhip: null });
    expect(result).toBe(60);
  });

  it("cuts soft party-whip pull in half", () => {
    const npp = makeNPP({ personality: { loyalty: 100, ambition: 50, stubbornness: 0 } });
    const result = computeWhipForce(npp, {
      partyWhip: makeWhip("for", "soft"),
      caucusWhip: null,
    });
    expect(result).toBe(30);
  });

  it("damps whip pull for stubborn, disloyal NPPs", () => {
    const npp = makeNPP({ personality: { loyalty: 0, ambition: 50, stubbornness: 100 } });
    const result = computeWhipForce(npp, { partyWhip: makeWhip("for"), caucusWhip: null });
    expect(result).toBe(0);
  });

  it("flips sign when whip is AGAINST", () => {
    const npp = makeNPP({ personality: { loyalty: 100, ambition: 50, stubbornness: 0 } });
    const result = computeWhipForce(npp, { partyWhip: makeWhip("against"), caucusWhip: null });
    expect(result).toBe(-60);
  });
});

describe("computeDistrictForce", () => {
  function makeStateDemographics(rural: number, urban: number): StateDemographics {
    return {
      _id: "OH",
      countryId: "US",
      categoryWeights: { voterGroups: 100 },
      groups: {
        rural_workers: { population: rural, economicLean: 0, socialLean: 0 },
        urban_professionals: { population: urban, economicLean: 0, socialLean: 0 },
      },
      lastUpdated: new Date(),
    };
  }

  it("returns 0 when bill has no policy option", () => {
    const bill = makeBill({
      provisions: [{ type: "policy", legislationTypeId: "tax-policy", effectDirection: 1 }],
    });
    expect(computeDistrictForce(bill, makeTaxType(), makeStateDemographics(50, 50))).toBe(0);
  });

  it("computes population-weighted approval", () => {
    const bill = makeBill({
      provisions: [
        {
          type: "policy",
          legislationTypeId: "tax-policy",
          policyOptionId: "raise-taxes",
          effectDirection: 1,
        },
      ],
    });
    const result = computeDistrictForce(bill, makeTaxType(), makeStateDemographics(70, 30));
    expect(result).toBeCloseTo(-19, 5);
  });

  it("returns 0 when state has no demographic data", () => {
    const bill = makeBill({
      provisions: [
        {
          type: "policy",
          legislationTypeId: "tax-policy",
          policyOptionId: "raise-taxes",
          effectDirection: 1,
        },
      ],
    });
    expect(computeDistrictForce(bill, makeTaxType(), null)).toBe(0);
  });

  it("returns 0 when legislation type is missing", () => {
    const bill = makeBill({
      provisions: [
        {
          type: "policy",
          legislationTypeId: "tax-policy",
          policyOptionId: "raise-taxes",
          effectDirection: 1,
        },
      ],
    });
    expect(computeDistrictForce(bill, null, makeStateDemographics(50, 50))).toBe(0);
  });
});

describe("computeDonorsForce", () => {
  it("returns 0 with a silent label when donor base is 0", () => {
    const npp = makeNPP({ donorBaseLevel: 0 });
    const bill = makeBill({ legislationTypeId: "tax-policy", effectDirection: 1 });
    const result = computeDonorsForce(npp, bill);
    expect(result.force).toBe(0);
    expect(result.label).toMatch(/silent/i);
  });

  it("scales by donor base and policy-vector alignment", () => {
    const npp = makeNPP({
      donorBaseLevel: 4,
      policies: { economic: -2, social: -2, domainPositions: {} },
    });
    const bill = makeBill({
      provisions: [
        {
          type: "policy",
          legislationTypeId: "clean-energy",
          policyOptionId: "green-new-deal",
          effectDirection: 1,
          economic: -3,
          social: -3,
        },
      ],
    });
    const result = computeDonorsForce(npp, bill);
    expect(result.force).toBeGreaterThan(40);
    expect(result.label).toMatch(/aligns/i);
  });

  it("opposes when the NPP is misaligned with the policy vector", () => {
    const npp = makeNPP({
      donorBaseLevel: 4,
      policies: { economic: 2, social: 2, domainPositions: {} },
    });
    const bill = makeBill({
      provisions: [
        {
          type: "policy",
          legislationTypeId: "clean-energy",
          policyOptionId: "green-new-deal",
          effectDirection: 1,
          economic: -3,
          social: -3,
        },
      ],
    });
    const result = computeDonorsForce(npp, bill);
    expect(result.force).toBeLessThan(-40);
    expect(result.label).toMatch(/opposes/i);
  });
});

describe("verdictFromForces", () => {
  it("produces FOR when sum > 5", () => {
    expect(verdictFromForces({ ideology: 6, whip: 0, district: 0, donors: 0 })).toBe("for");
  });

  it("produces AGAINST when sum < -5", () => {
    expect(verdictFromForces({ ideology: -6, whip: 0, district: 0, donors: 0 })).toBe("against");
  });

  it("produces ABSTAIN inside the dead zone", () => {
    expect(verdictFromForces({ ideology: 4, whip: -3, district: 4, donors: 0 })).toBe("abstain");
  });

  it("treats exact boundary as abstain", () => {
    expect(verdictFromForces({ ideology: 5, whip: 0, district: 0, donors: 0 })).toBe("abstain");
    expect(verdictFromForces({ ideology: -5, whip: 0, district: 0, donors: 0 })).toBe("abstain");
  });
});

describe("computePartyLineForce", () => {
  it("returns positive force when NPP is in sponsor party", () => {
    const npp = makeNPP({
      party: "dem",
      personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
    });
    const force = computePartyLineForce(npp, "dem");
    expect(force).toBeGreaterThan(5); // must exceed VERDICT_THRESHOLD to break ties
  });

  it("returns 0 when NPP is not in sponsor party", () => {
    const npp = makeNPP({ party: "dem" });
    expect(computePartyLineForce(npp, "rep")).toBe(0);
  });

  it("returns 0 when sponsorParty is undefined", () => {
    const npp = makeNPP({ party: "dem" });
    expect(computePartyLineForce(npp, undefined)).toBe(0);
  });

  it("scales with compliance — loyal NPP gets stronger party bias than stubborn one", () => {
    const loyal = makeNPP({
      party: "dem",
      personality: { loyalty: 100, ambition: 50, stubbornness: 0 },
    });
    const stubborn = makeNPP({
      party: "dem",
      personality: { loyalty: 0, ambition: 50, stubbornness: 100 },
    });
    expect(computePartyLineForce(loyal, "dem")).toBeGreaterThan(
      computePartyLineForce(stubborn, "dem")
    );
  });
});

describe("computeCrossPressureForces (integration)", () => {
  it("composes all four forces deterministically", () => {
    const npp = makeNPP({
      donorBaseLevel: 3,
      personality: { loyalty: 100, ambition: 50, stubbornness: 0 },
      policies: { economic: -2, social: 0, domainPositions: {} },
    });
    const bill = makeBill({
      legislationTypeId: "tax-policy",
      effectDirection: 1,
      provisions: [
        {
          type: "policy",
          legislationTypeId: "tax-policy",
          policyOptionId: "raise-taxes",
          effectDirection: 1,
        },
      ],
    });
    const legType = makeTaxType();
    legType.policyOptions![0].archetypeApprovals = { urban_professionals: 50 };
    const demographics: StateDemographics = {
      _id: "OH",
      countryId: "US",
      categoryWeights: { voterGroups: 100 },
      groups: {
        urban_professionals: { population: 100, economicLean: 0, socialLean: 0 },
      },
      lastUpdated: new Date(),
    };

    const { forces, donorsLabel } = computeCrossPressureForces(npp, bill, {
      legislationType: legType,
      homeStateDemographics: demographics,
      whips: { partyWhip: makeWhip("for"), caucusWhip: null },
    });

    expect(forces.ideology).toBeCloseTo(40, 5);
    expect(forces.whip).toBe(60);
    expect(forces.district).toBeCloseTo(50, 5);
    expect(forces.donors).toBeCloseTo(24, 5);
    expect(donorsLabel).toMatch(/aligns/i);
    expect(verdictFromForces(forces)).toBe("for");
  });
});
