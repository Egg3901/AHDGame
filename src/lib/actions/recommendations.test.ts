// src/lib/actions/recommendations.test.ts
import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Character, PartyBudget, PoliticalParty, StatePartyOrg } from "@/lib/db/types";
import {
  checkStatThresholds,
  findUnownedOpportunities,
  compareMarketPosition,
  checkPartyActions,
  checkGettingStarted,
  generateRecommendations,
} from "./recommendations";
import type { StateEconomyData, CorpMarketPosition } from "./recommendations";

// Helper to create a minimal character
function createCharacter(overrides: Partial<Character> = {}): Character {
  return {
    _id: new ObjectId(),
    userId: new ObjectId(),
    name: "Test Character",
    homeState: "GA",
    actions: 50,
    funds: 100_000,
    cashOnHand: 50_000,
    politicalInfluence: 25,
    favorability: 55,
    infamy: 0,
    donorBaseLevel: 1,
    party: null,
    currentOffice: null,
    avatarUrl: "https://example.com/pfp.jpg",
    profileHeaderImageUrl: "https://example.com/header.jpg",
    countryId: "US" as const,
    ...overrides,
  } as Character;
}

describe("checkStatThresholds", () => {
  it("returns no recommendations for healthy stats", () => {
    const character = createCharacter({
      actions: 50,
      funds: 500_000,
      politicalInfluence: 50,
      favorability: 60,
      donorBaseLevel: 2,
    });
    const recs = checkStatThresholds(character, "GA");
    expect(recs.length).toBe(0);
  });

  it("flags action hoarding when above 100 AP", () => {
    const character = createCharacter({ actions: 150 });
    const recs = checkStatThresholds(character, "GA");
    const hoardingRec = recs.find((r) => r.id.includes("actions-hoarding"));
    expect(hoardingRec).toBeDefined();
    expect(hoardingRec?.priority).toBe("high");
    expect(hoardingRec?.why).toContain("150");
    expect(hoardingRec?.why).toContain("100");
  });

  it("flags critically low actions", () => {
    const character = createCharacter({ actions: 3 });
    const recs = checkStatThresholds(character, "GA");
    const lowRec = recs.find((r) => r.id.includes("actions-low"));
    expect(lowRec).toBeDefined();
    expect(lowRec?.priority).toBe("critical");
  });

  it("flags low favorability", () => {
    const character = createCharacter({ favorability: 35 });
    const recs = checkStatThresholds(character, "GA");
    const favRec = recs.find((r) => r.id.includes("favorability-low"));
    expect(favRec).toBeDefined();
    expect(favRec?.priority).toBe("high");
  });

  it("flags critically low favorability", () => {
    const character = createCharacter({ favorability: 25 });
    const recs = checkStatThresholds(character, "GA");
    const favRec = recs.find((r) => r.id.includes("favorability-low"));
    expect(favRec).toBeDefined();
    expect(favRec?.priority).toBe("critical");
  });

  it("flags low influence", () => {
    const character = createCharacter({ politicalInfluence: 10 });
    const recs = checkStatThresholds(character, "GA");
    const infRec = recs.find((r) => r.id.includes("influence-low"));
    expect(infRec).toBeDefined();
    expect(infRec?.priority).toBe("high");
  });

  it("flags critically low funds with donor base", () => {
    const character = createCharacter({ funds: 10_000, donorBaseLevel: 2 });
    const recs = checkStatThresholds(character, "GA");
    const fundsRec = recs.find((r) => r.id.includes("funds-critical"));
    expect(fundsRec).toBeDefined();
    expect(fundsRec?.priority).toBe("critical");
    expect(fundsRec?.action.type).toBe("fundraise");
  });

  it("flags critically low funds without donor base", () => {
    const character = createCharacter({ funds: 10_000, donorBaseLevel: 0 });
    const recs = checkStatThresholds(character, "GA");
    const fundsRec = recs.find((r) => r.id.includes("funds-critical-no-donor"));
    expect(fundsRec).toBeDefined();
    expect(fundsRec?.priority).toBe("critical");
    expect(fundsRec?.action.type).toBe("buildDonorBase");
  });

  it("flags low funds (not critical)", () => {
    const character = createCharacter({ funds: 50_000, donorBaseLevel: 1 });
    const recs = checkStatThresholds(character, "GA");
    const fundsRec = recs.find((r) => r.id.includes("funds-low"));
    expect(fundsRec).toBeDefined();
    expect(fundsRec?.priority).toBe("medium");
  });

  it("suggests converting cash when high cash, low funds", () => {
    const character = createCharacter({ cashOnHand: 500_000, funds: 50_000 });
    const recs = checkStatThresholds(character, "GA");
    const convertRec = recs.find((r) => r.id.includes("convert-cash"));
    expect(convertRec).toBeDefined();
    expect(convertRec?.priority).toBe("medium");
    expect(convertRec?.action.type).toBe("convertCash");
  });

  it("does not suggest converting savings-only wealth", () => {
    const character = createCharacter({ cashOnHand: 0, savingsOnHand: 500_000, funds: 50_000 });
    const recs = checkStatThresholds(character, "GA");
    const convertRec = recs.find((r) => r.id.includes("convert-cash"));
    expect(convertRec).toBeUndefined();
  });
});

describe("findUnownedOpportunities", () => {
  it("returns no recommendations when no large unowned sectors", () => {
    const character = createCharacter({ homeState: "GA" });
    const economy: StateEconomyData = {
      stateId: "GA",
      stateName: "Georgia",
      countryId: "US",
      sectors: [
        {
          type: "technology",
          label: "Technology",
          totalMarket: 1_000_000_000,
          ownedRevenue: 900_000_000,
          unownedRevenue: 100_000_000,
          unownedPercent: 10,
          splitCost: 5_000_000,
          estimatedCapture: 6_250_000,
          estimatedCapturePercent: 6.25,
        },
      ],
    };
    const recs = findUnownedOpportunities([economy], character);
    expect(recs.length).toBe(0);
  });

  it("flags large unowned sectors (>30%)", () => {
    const character = createCharacter({ homeState: "GA" });
    const economy: StateEconomyData = {
      stateId: "GA",
      stateName: "Georgia",
      countryId: "US",
      sectors: [
        {
          type: "retail",
          label: "Retail",
          totalMarket: 1_000_000_000,
          ownedRevenue: 600_000_000,
          unownedRevenue: 400_000_000,
          unownedPercent: 40,
          splitCost: 20_000_000,
          estimatedCapture: 25_000_000,
          estimatedCapturePercent: 6.25,
        },
      ],
    };
    const recs = findUnownedOpportunities([economy], character);
    expect(recs.length).toBe(1);
    expect(recs[0].priority).toBe("medium");
    expect(recs[0].action.targetState).toBe("GA");
    expect(recs[0].action.targetSectorType).toBe("retail");
  });

  it("flags huge unowned sectors (>50%) as high priority", () => {
    const character = createCharacter({ homeState: "GA" });
    // Need 3+ opportunities for high priority (consolidated recommendation)
    const economy: StateEconomyData = {
      stateId: "GA",
      stateName: "Georgia",
      countryId: "US",
      sectors: [
        {
          type: "energy",
          label: "Energy",
          totalMarket: 1_000_000_000,
          ownedRevenue: 400_000_000,
          unownedRevenue: 600_000_000,
          unownedPercent: 60,
          splitCost: 30_000_000,
          estimatedCapture: 37_500_000,
          estimatedCapturePercent: 6.25,
        },
      ],
    };
    const recs = findUnownedOpportunities([economy], character, ["energy"]);
    expect(recs.length).toBe(1);
    expect(recs[0].priority).toBe("medium"); // Single sector type = medium
  });
});

describe("compareMarketPosition", () => {
  it("returns no recommendations when market position is healthy", () => {
    const character = createCharacter();
    const positions: CorpMarketPosition[] = [
      {
        corporationId: "corp1",
        corporationName: "Test Corp",
        revenue: 100_000_000,
        marketSharePercent: 25,
        sectorType: "technology",
        stateId: "GA",
        avgMarketShare: 20,
      },
    ];
    const recs = compareMarketPosition(positions, character);
    expect(recs.length).toBe(0);
  });

  it("flags underperforming market share (<50% of avg)", () => {
    const character = createCharacter();
    const positions: CorpMarketPosition[] = [
      {
        corporationId: "corp1",
        corporationName: "Test Corp",
        revenue: 10_000_000,
        marketSharePercent: 5,
        sectorType: "technology",
        stateId: "GA",
        avgMarketShare: 20,
      },
    ];
    const recs = compareMarketPosition(positions, character);
    expect(recs.length).toBe(1);
    expect(recs[0].priority).toBe("medium");
    expect(recs[0].category).toBe("competitive");
    expect(recs[0].action.type).toBe("split");
  });

  it("skips recommendation when user is only corp in sector (avgMarketShare = 100%)", () => {
    const character = createCharacter();
    const positions: CorpMarketPosition[] = [
      {
        corporationId: "corp1",
        corporationName: "Test Corp",
        revenue: 100_000_000,
        marketSharePercent: 100,
        sectorType: "defense",
        stateId: "GA",
        avgMarketShare: 100,
      },
    ];
    const recs = compareMarketPosition(positions, character);
    expect(recs.length).toBe(0);
  });
});

describe("checkPartyActions", () => {
  it("returns no recommendations without party data", () => {
    const character = createCharacter();
    const recs = checkPartyActions(null, null, null, character);
    expect(recs.length).toBe(0);
  });

  it("suggests GOTV when national party treasury is healthy", () => {
    const character = createCharacter({ party: "1" });
    const party: PoliticalParty = {
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Democrats",
      abbreviation: "DEM",
      color: "#0000FF",
      economicPosition: -40,
      socialPosition: -30,
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      committeeIds: [],
      memberCount: 10,
      isDefault: true,
      createdBy: null,
      treasury: 500_000,
      nationalTaxRate: 10,
      politicalStrength: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const partyBudget: PartyBudget = {
      _id: new ObjectId(),
      partyId: "1",
      scope: "national" as const,
      countryId: "US",
      gotvBudgetPerTurn: 0,
      gotvBudgetPercent: 0,
      orgBuildingPercent: 0,
      suppressionBudgetPercent: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const recs = checkPartyActions(party, partyBudget, null, character);
    const gotvRec = recs.find((r) => r.action.type === "gotv");
    expect(gotvRec).toBeDefined();
    expect(gotvRec?.priority).toBe("medium");
    expect(gotvRec?.link).toBe("/country/us/parties/1?tab=treasury");
  });

  it("does not suggest GOTV when partyBudget alone is provided (no treasury source)", () => {
    const character = createCharacter({ party: "1" });
    const partyBudget: PartyBudget = {
      _id: new ObjectId(),
      partyId: "1",
      scope: "national" as const,
      countryId: "US",
      gotvBudgetPerTurn: 0,
      gotvBudgetPercent: 0,
      orgBuildingPercent: 0,
      suppressionBudgetPercent: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const recs = checkPartyActions(null, partyBudget, null, character);
    expect(recs.find((r) => r.action.type === "gotv")).toBeUndefined();
  });

  it("suggests Build Org when PS is available", () => {
    const character = createCharacter({ party: "democrats" });
    const statePartyOrg: StatePartyOrg = {
      _id: "GA_democrats",
      countryId: "US",
      stateId: "GA",
      partyId: "democrats",
      organization: 30,
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      treasury: 50_000,
      stateTaxRate: 0,
      politicalStrength: 10, // has PS to spend
      createdAt: new Date(),
      updatedAt: new Date(),
      hasPresence: true,
    };
    const partyBudget: PartyBudget = {
      _id: new ObjectId(),
      partyId: "democrats",
      scope: "state" as const,
      countryId: "US",
      stateId: "GA",
      gotvBudgetPerTurn: 0,
      gotvBudgetPercent: 0,
      orgBuildingPercent: 0,
      suppressionBudgetPercent: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const recs = checkPartyActions(null, partyBudget, statePartyOrg, character);
    const orgRec = recs.find((r) => r.action.type === "build-org");
    expect(orgRec).toBeDefined();
    expect(orgRec?.priority).toBe("high");
  });

  it("does not suggest Build Org when PS is zero (nothing to spend)", () => {
    const character = createCharacter({ party: "democrats" });
    const statePartyOrg: StatePartyOrg = {
      _id: "GA_democrats",
      countryId: "US",
      stateId: "GA",
      partyId: "democrats",
      organization: 30,
      chairId: null,
      viceChairId: null,
      treasurerId: null,
      treasury: 50_000,
      stateTaxRate: 0,
      politicalStrength: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      hasPresence: true,
    };
    const partyBudget: PartyBudget = {
      _id: new ObjectId(),
      partyId: "democrats",
      scope: "state" as const,
      countryId: "US",
      stateId: "GA",
      gotvBudgetPerTurn: 0,
      gotvBudgetPercent: 0,
      orgBuildingPercent: 0,
      suppressionBudgetPercent: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const recs = checkPartyActions(null, partyBudget, statePartyOrg, character);
    expect(recs.find((r) => r.action.type === "build-org")).toBeUndefined();
  });
});

describe("generateRecommendations", () => {
  it("returns sorted recommendations by priority", () => {
    const character = createCharacter({
      actions: 150, // hoarding (high)
      funds: 10_000, // critical
      donorBaseLevel: 1,
    });
    const recs = generateRecommendations({ character, currentTurn: 1 });
    expect(recs.length).toBeGreaterThan(1);
    // First should be critical
    expect(recs[0].priority).toBe("critical");
  });

  it("limits to top 10 recommendations", () => {
    const character = createCharacter({
      actions: 150,
      funds: 10_000,
      donorBaseLevel: 1,
      favorability: 30,
      politicalInfluence: 5,
      cashOnHand: 500_000,
    });
    const recs = generateRecommendations({ character, currentTurn: 1 });
    expect(recs.length).toBeLessThanOrEqual(10);
  });

  it("includes unowned sector opportunities", () => {
    const character = createCharacter({ homeState: "GA" });
    const homeStateEconomy: StateEconomyData = {
      stateId: "GA",
      stateName: "Georgia",
      countryId: "US",
      sectors: [
        {
          type: "retail",
          label: "Retail",
          totalMarket: 1_000_000_000,
          ownedRevenue: 400_000_000,
          unownedRevenue: 600_000_000,
          unownedPercent: 60,
          splitCost: 30_000_000,
          estimatedCapture: 37_500_000,
          estimatedCapturePercent: 6.25,
        },
      ],
    };
    const recs = generateRecommendations({
      character,
      homeStateEconomy,
      allStateEconomies: [homeStateEconomy],
      currentTurn: 1,
      userCorpSectorTypes: ["retail"], // Must include sector type to show opportunity
    });
    const unownedRec = recs.find((r) => r.id.includes("unowned-consolidated-retail"));
    expect(unownedRec).toBeDefined();
  });

  it("includes competitive market position recommendations", () => {
    const character = createCharacter();
    const marketPositions: CorpMarketPosition[] = [
      {
        corporationId: "corp1",
        corporationName: "Test Corp",
        revenue: 10_000_000,
        marketSharePercent: 5,
        sectorType: "technology",
        stateId: "GA",
        avgMarketShare: 25,
      },
    ];
    const recs = generateRecommendations({
      character,
      marketPositions,
      currentTurn: 1,
    });
    const msRec = recs.find((r) => r.id.includes("low-ms"));
    expect(msRec).toBeDefined();
  });
});

describe("checkGettingStarted", () => {
  it("nags a plan-less character, which is what every pre-plan character is", () => {
    const items = checkGettingStarted(createCharacter(), false, false);
    expect(items.map((r) => r.category)).toEqual([
      "getting-started",
      "getting-started",
      "getting-started",
    ]);
  });

  it("stays quiet for a player who never asked to be shown politics", () => {
    const investor = createCharacter({
      tutorial: {
        experience: "new",
        interests: ["invest"],
        chosenAt: new Date("2026-07-27"),
      },
    });
    expect(checkGettingStarted(investor, false, false)).toEqual([]);
  });

  it("still nags a player who asked for the top job", () => {
    const statesman = createCharacter({
      tutorial: {
        experience: "new",
        interests: ["nation"],
        chosenAt: new Date("2026-07-27"),
      },
    });
    expect(checkGettingStarted(statesman, false, false).length).toBeGreaterThan(0);
  });

  it("honors the legacy politics track", () => {
    const legacy = createCharacter({ tutorialTrack: "politics" });
    expect(checkGettingStarted(legacy, false, false).length).toBeGreaterThan(0);
  });
});
