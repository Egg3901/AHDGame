import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { StateDemographicTurnout, PartyBudget, StatePartyOrg } from "@/lib/db/types";
import {
  applyDecayToAllStates,
  processPartyGOTV,
  processPlayerCanvassing,
} from "@/lib/turn/demographicTurnoutTurn";

// processPartyGOTV calls calculatePartyRevenue internally, which requires a DB connection.
// Mock it here so integration tests don't need a live MongoDB.
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

beforeEach(async () => {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue({
    collection: vi.fn().mockReturnValue({
      findOne: vi.fn().mockResolvedValue({ stateTaxRate: 0 }),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    }),
  } as never);
});

function createEmptyModifiers() {
  return {
    race: { white: 0, black: 0, hispanic: 0, asian: 0, other: 0 },
    age: { young: 0, mid: 0, mature: 0, senior: 0 },
    education: { no_college: 0, college: 0, graduate: 0 },
    wealth: { low: 0, middle: 0, high: 0 },
    ideology: {
      evangelicals: 0,
      environmentalists: 0,
      libertarians: 0,
      progressives: 0,
      patriots: 0,
      gunowners: 0,
    },
  };
}

describe("Demographic Turnout Integration", () => {
  describe("Full Cycle: GOTV → Decay → Canvass", () => {
    it("processes complete turnout modification cycle", async () => {
      // Setup test data
      const mockTurnout: StateDemographicTurnout = {
        _id: "PA",
        countryId: "US",
        modifiers: createEmptyModifiers(),
        lastDecayApplied: new Date(),
        lastUpdated: new Date(),
      };

      const stateId = "PA";
      const partyId = "GOP";
      const mockBudget: PartyBudget = {
        _id: new ObjectId(),
        partyId,
        countryId: "US",
        scope: "state",
        stateId,
        gotvBudgetPerTurn: 100,
        gotvBudgetPercent: 0,
        // Explicit target required by processPartyGOTV — evangelicals align with party (+4,+5)
        gotvTargetCategory: "ideology",
        gotvTargetGroup: "evangelicals",
        suppressionBudgetPercent: 0,
        orgBuildingPercent: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Treasury source lives on statePartyOrg in production; inject it for the test.
      const mockStatePartyOrg = {
        _id: `${stateId}_${partyId}`,
        countryId: "US",
        stateId,
        partyId,
        treasury: 10000,
      } as unknown as StatePartyOrg;

      const partyPosition = { economic: 4, social: 5 };

      // Step 1: Party GOTV boosts aligned demographics
      const gotvResult = await processPartyGOTV(
        [mockBudget],
        [mockTurnout],
        partyPosition,
        undefined,
        undefined,
        [mockStatePartyOrg]
      );

      // Evangelicals (+4, +5) should be boosted (within 2 points of party)
      expect(gotvResult.turnout[0].modifiers.ideology.evangelicals).toBeGreaterThan(0);

      // Step 2: Apply decay
      const decayResult = await applyDecayToAllStates(gotvResult.turnout);
      const afterDecay = decayResult[0].modifiers.ideology.evangelicals;
      const afterGOTV = gotvResult.turnout[0].modifiers.ideology.evangelicals;

      // Should decay by 2%
      expect(afterDecay).toBeCloseTo(afterGOTV * 0.98, 2);

      // Step 3: Player canvassing
      const canvassingAction = {
        characterId: new ObjectId(),
        stateId: "PA",
        demographic: { category: "ideology", group: "evangelicals" },
        characterPosition: { economic: 4, social: 5 },
        costFunds: 100,
        costActions: 1,
        isActiveCampaignSeason: true,
      };

      const canvassResult = await processPlayerCanvassing([canvassingAction], decayResult);

      // Should be higher than after decay
      expect(canvassResult[0].modifiers.ideology.evangelicals).toBeGreaterThan(afterDecay);
    });
  });

  describe("Cap Enforcement (+/-20%)", () => {
    it("respects +20% cap", async () => {
      const mockTurnout: StateDemographicTurnout = {
        _id: "PA",
        countryId: "US",
        modifiers: {
          ...createEmptyModifiers(),
          race: { white: 19.5, black: 0, hispanic: 0, asian: 0, other: 0 },
        },
        lastDecayApplied: new Date(),
        lastUpdated: new Date(),
      };

      const canvassingAction = {
        characterId: new ObjectId(),
        stateId: "PA",
        demographic: { category: "race", group: "white" },
        characterPosition: { economic: 1, social: 1 },
        costFunds: 100,
        costActions: 1,
        isActiveCampaignSeason: true,
      };

      const result = await processPlayerCanvassing([canvassingAction], [mockTurnout]);

      // Should be capped at 20
      expect(result[0].modifiers.race.white).toBeLessThanOrEqual(20);
    });

    it("respects -20% cap", async () => {
      const mockTurnout: StateDemographicTurnout = {
        _id: "PA",
        countryId: "US",
        modifiers: {
          ...createEmptyModifiers(),
          race: { white: 0, black: -19.5, hispanic: 0, asian: 0, other: 0 },
        },
        lastDecayApplied: new Date(),
        lastUpdated: new Date(),
      };

      // Apply large negative modifier (should cap at -20)
      mockTurnout.modifiers.race.black = -19.9;
      const decayResult = await applyDecayToAllStates([mockTurnout]);

      // Should stay at or above -20
      expect(decayResult[0].modifiers.race.black).toBeGreaterThanOrEqual(-20);
    });
  });

  describe("Diminishing Returns", () => {
    it("applies diminishing returns at high modifiers", async () => {
      const lowModifier: StateDemographicTurnout = {
        _id: "PA",
        countryId: "US",
        modifiers: {
          ...createEmptyModifiers(),
          age: { young: 2, mid: 0, mature: 0, senior: 0 },
        },
        lastDecayApplied: new Date(),
        lastUpdated: new Date(),
      };

      const highModifier: StateDemographicTurnout = {
        _id: "CA",
        countryId: "US",
        modifiers: {
          ...createEmptyModifiers(),
          age: { young: 15, mid: 0, mature: 0, senior: 0 },
        },
        lastDecayApplied: new Date(),
        lastUpdated: new Date(),
      };

      const canvassingAction = {
        characterId: new ObjectId(),
        stateId: "PA",
        demographic: { category: "age", group: "young" },
        characterPosition: { economic: -3, social: -3 },
        costFunds: 100,
        costActions: 1,
        isActiveCampaignSeason: true,
      };

      // Apply same action to low and high modifier states
      const lowResult = await processPlayerCanvassing(
        [{ ...canvassingAction, stateId: "PA" }],
        [lowModifier]
      );
      const highResult = await processPlayerCanvassing(
        [{ ...canvassingAction, stateId: "CA" }],
        [highModifier]
      );

      const lowBoost = lowResult[0].modifiers.age.young - 2;
      const highBoost = highResult[0].modifiers.age.young - 15;

      // Low modifier should receive larger boost due to diminishing returns
      expect(lowBoost).toBeGreaterThan(highBoost);
    });
  });

  describe("Decay Mechanics", () => {
    it("applies 2% decay per turn", async () => {
      const mockTurnout: StateDemographicTurnout = {
        _id: "PA",
        countryId: "US",
        modifiers: {
          ...createEmptyModifiers(),
          race: { white: 10, black: -5, hispanic: 0, asian: 0, other: 0 },
        },
        lastDecayApplied: new Date(),
        lastUpdated: new Date(),
      };

      const result = await applyDecayToAllStates([mockTurnout]);

      // Positive modifier: 10 * 0.98 = 9.8
      expect(result[0].modifiers.race.white).toBeCloseTo(9.8, 1);
      // Negative modifier: -5 * 0.98 = -4.9
      expect(result[0].modifiers.race.black).toBeCloseTo(-4.9, 1);
    });

    it("rounds to zero when below threshold", async () => {
      const mockTurnout: StateDemographicTurnout = {
        _id: "PA",
        countryId: "US",
        modifiers: {
          ...createEmptyModifiers(),
          race: { white: 0.005, black: 0, hispanic: 0, asian: 0, other: 0 },
        },
        lastDecayApplied: new Date(),
        lastUpdated: new Date(),
      };

      const result = await applyDecayToAllStates([mockTurnout]);

      // Should round to 0 (below 0.01 threshold)
      expect(result[0].modifiers.race.white).toBe(0);
    });
  });

  describe("Party GOTV Alignment", () => {
    it("only boosts demographics within 2 points", async () => {
      const mockTurnout: StateDemographicTurnout = {
        _id: "PA",
        countryId: "US",
        modifiers: createEmptyModifiers(),
        lastDecayApplied: new Date(),
        lastUpdated: new Date(),
      };

      const stateId = "PA";
      const partyId = "DEM";
      const mockBudget: PartyBudget = {
        _id: new ObjectId(),
        partyId,
        countryId: "US",
        scope: "state",
        stateId,
        gotvBudgetPerTurn: 100,
        gotvBudgetPercent: 0,
        // Explicit target required — progressives (-5,-5) align with DEM at (-4,-4)
        gotvTargetCategory: "ideology",
        gotvTargetGroup: "progressives",
        suppressionBudgetPercent: 0,
        orgBuildingPercent: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockStatePartyOrg = {
        _id: `${stateId}_${partyId}`,
        countryId: "US",
        stateId,
        partyId,
        treasury: 10000,
      } as unknown as StatePartyOrg;

      // Party at -4, -4 (liberal)
      const partyPosition = { economic: -4, social: -4 };

      const result = await processPartyGOTV(
        [mockBudget],
        [mockTurnout],
        partyPosition,
        undefined,
        undefined,
        [mockStatePartyOrg]
      );

      // Progressives at -5, -5 should be boosted (within 2 points)
      expect(result.turnout[0].modifiers.ideology.progressives).toBeGreaterThan(0);

      // Evangelicals at +4, +5 should NOT be boosted (too far)
      expect(result.turnout[0].modifiers.ideology.evangelicals).toBe(0);
    });
  });

  describe("Player Canvassing Alignment", () => {
    it("scales effectiveness by alignment distance", async () => {
      const mockTurnout: StateDemographicTurnout = {
        _id: "PA",
        countryId: "US",
        modifiers: createEmptyModifiers(),
        lastDecayApplied: new Date(),
        lastUpdated: new Date(),
      };

      // Perfect alignment (distance = 0)
      const perfectAction = {
        characterId: new ObjectId(),
        stateId: "PA",
        demographic: { category: "ideology", group: "progressives" },
        characterPosition: { economic: -5, social: -5 },
        costFunds: 100,
        costActions: 1,
        isActiveCampaignSeason: false,
      };

      // Poor alignment (distance = 10)
      const poorAction = {
        characterId: new ObjectId(),
        stateId: "PA",
        demographic: { category: "ideology", group: "progressives" },
        characterPosition: { economic: 5, social: 5 },
        costFunds: 100,
        costActions: 1,
        isActiveCampaignSeason: false,
      };

      const perfectResult = await processPlayerCanvassing([perfectAction], [{ ...mockTurnout }]);
      const poorResult = await processPlayerCanvassing([poorAction], [{ ...mockTurnout }]);

      // Perfect alignment should produce larger boost
      expect(perfectResult[0].modifiers.ideology.progressives).toBeGreaterThan(
        poorResult[0].modifiers.ideology.progressives
      );
    });

    it("applies 2x multiplier during campaign season", async () => {
      const mockTurnout: StateDemographicTurnout = {
        _id: "PA",
        countryId: "US",
        modifiers: createEmptyModifiers(),
        lastDecayApplied: new Date(),
        lastUpdated: new Date(),
      };

      const baseAction = {
        characterId: new ObjectId(),
        stateId: "PA",
        demographic: { category: "age", group: "young" },
        characterPosition: { economic: -3, social: -3 },
        costFunds: 100,
        costActions: 1,
        isActiveCampaignSeason: false,
      };

      const offSeasonResult = await processPlayerCanvassing([baseAction], [{ ...mockTurnout }]);
      const campaignSeasonResult = await processPlayerCanvassing(
        [{ ...baseAction, isActiveCampaignSeason: true }],
        [{ ...mockTurnout }]
      );

      // Campaign season should be roughly 2x more effective
      const offSeasonBoost = offSeasonResult[0].modifiers.age.young;
      const campaignBoost = campaignSeasonResult[0].modifiers.age.young;

      expect(campaignBoost).toBeCloseTo(offSeasonBoost * 2, 1);
    });
  });
});
