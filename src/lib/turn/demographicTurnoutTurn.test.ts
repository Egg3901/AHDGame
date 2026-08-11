import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  applyDecayToAllStates,
  processPartyGOTV,
  processPlayerCanvassing,
} from "./demographicTurnoutTurn";
import type {
  StateDemographicTurnout,
  StatePartyOrg,
  PoliticalParty,
  PartyBudget,
} from "@/lib/db/types";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/treasury/emit", () => ({
  emitTreasuryTransaction: vi.fn().mockResolvedValue(null),
}));

describe("demographicTurnoutTurn", () => {
  describe("applyDecayToAllStates", () => {
    it("applies 2% decay to all modifiers", async () => {
      const mockData: StateDemographicTurnout = {
        _id: "PA",
        modifiers: {
          race: { white: 10, black: 5, hispanic: 0, asian: -3, other: 0 },
          age: { young: 8, mid: 0, mature: 0, senior: 0 },
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
        },
        countryId: "US",
        lastDecayApplied: new Date(),
        lastUpdated: new Date(),
      };

      const result = await applyDecayToAllStates([mockData]);

      expect(result[0].modifiers.race.white).toBeCloseTo(9.8);
      expect(result[0].modifiers.race.black).toBeCloseTo(4.9);
      expect(result[0].modifiers.race.asian).toBeCloseTo(-2.94);
      expect(result[0].modifiers.age.young).toBeCloseTo(7.84);
    });

    it("rounds to zero when below threshold", async () => {
      const mockData: StateDemographicTurnout = {
        _id: "PA",
        modifiers: {
          race: { white: 0.005, black: 0, hispanic: 0, asian: 0, other: 0 },
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
        },
        countryId: "US",
        lastDecayApplied: new Date(),
        lastUpdated: new Date(),
      };

      const result = await applyDecayToAllStates([mockData]);

      expect(result[0].modifiers.race.white).toBe(0);
    });

    it("processes multiple states correctly", async () => {
      const mockData: StateDemographicTurnout[] = [
        {
          _id: "PA",
          modifiers: {
            race: { white: 10, black: 0, hispanic: 0, asian: 0, other: 0 },
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
          },
          countryId: "US",
          lastDecayApplied: new Date(),
          lastUpdated: new Date(),
        },
        {
          _id: "CA",
          modifiers: {
            race: { white: 0, black: 5, hispanic: 0, asian: 0, other: 0 },
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
          },
          countryId: "US",
          lastDecayApplied: new Date(),
          lastUpdated: new Date(),
        },
        {
          _id: "TX",
          modifiers: {
            race: { white: 0, black: 0, hispanic: -8, asian: 0, other: 0 },
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
          },
          countryId: "US",
          lastDecayApplied: new Date(),
          lastUpdated: new Date(),
        },
      ];

      const result = await applyDecayToAllStates(mockData);

      expect(result).toHaveLength(3);
      expect(result[0]._id).toBe("PA");
      expect(result[0].modifiers.race.white).toBeCloseTo(9.8);
      expect(result[1]._id).toBe("CA");
      expect(result[1].modifiers.race.black).toBeCloseTo(4.9);
      expect(result[2]._id).toBe("TX");
      expect(result[2].modifiers.race.hispanic).toBeCloseTo(-7.84);
    });
  });

  describe("processPartyGOTV", () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      const { getDb } = await import("@/lib/mongodb");
      // calculatePartyRevenue calls getDb for tax calculations; return stateTaxRate=0 to short-circuit.
      vi.mocked(getDb).mockResolvedValue({
        collection: vi.fn().mockReturnValue({
          findOne: vi.fn().mockResolvedValue({ stateTaxRate: 0 }),
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        }),
      } as never);
    });

    it("boosts eligible demographics based on party position", async () => {
      const mockBudget = {
        _id: new ObjectId(),
        partyId: "GOP",
        countryId: "US" as const,
        scope: "state" as const,
        stateId: "PA",
        gotvBudgetPerTurn: 100,
        gotvBudgetPercent: 0,
        // Explicit target required by processPartyGOTV — without these, GOTV does nothing
        gotvTargetCategory: "ideology",
        gotvTargetGroup: "evangelicals",
        suppressionBudgetPercent: 0,
        orgBuildingPercent: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Treasury source lives on statePartyOrg in production; inject it for the test.
      const mockStatePartyOrg = {
        _id: `${mockBudget.stateId}_${mockBudget.partyId}`,
        countryId: "US",
        stateId: mockBudget.stateId,
        partyId: mockBudget.partyId,
        treasury: 1000,
      } as unknown as StatePartyOrg;

      const mockTurnout: StateDemographicTurnout = {
        _id: "PA",
        modifiers: {
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
        },
        countryId: "US",
        lastDecayApplied: new Date(),
        lastUpdated: new Date(),
      };

      // Party at +4, +4; evangelicals at +4, +5 (eligible)
      const partyPosition = { economic: 4, social: 4 };

      const result = await processPartyGOTV(
        [mockBudget],
        [mockTurnout],
        partyPosition,
        undefined,
        undefined,
        [mockStatePartyOrg]
      );

      // Evangelicals should receive boost
      expect(result.turnout[0].modifiers.ideology.evangelicals).toBeGreaterThan(0);

      // Progressives should NOT receive boost (too far from party position)
      expect(result.turnout[0].modifiers.ideology.progressives).toBe(0);
    });

    // Regression test: the national-scope bulkWrite used to filter by
    // { slug: partyId } — a field that doesn't exist on PoliticalParty —
    // so national party treasury was never actually deducted for GOTV
    // spending. Fixed by filtering on (countryId, sequentialId).
    it("deducts national GOTV spend from politicalParties with (countryId, sequentialId) filter", async () => {
      const db: MockDb = createMockDb();
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

      const partyId = "1";
      const partyCountry = "US";
      const stateId = "PA";
      const statePopulation = 100_000;

      const nationalBudget = {
        _id: new ObjectId(),
        partyId,
        countryId: partyCountry,
        scope: "national",
        gotvBudgetPerTurn: 1_000, // triggers spend via the legacy flat-amount path
        gotvBudgetPercent: 0,
        gotvTargetCategory: "ideology",
        gotvTargetGroup: "evangelicals",
        suppressionBudgetPercent: 0,
        orgBuildingPercent: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as PartyBudget;

      const mockTurnout: StateDemographicTurnout = {
        _id: stateId,
        countryId: "US",
        modifiers: {
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
        },
        lastDecayApplied: new Date(),
        lastUpdated: new Date(),
      };

      const mockParty = {
        _id: new ObjectId(),
        sequentialId: Number(partyId),
        countryId: partyCountry,
        name: "DEM",
        economicPosition: 4,
        socialPosition: 5,
        treasury: 10_000, // enough to cover the 1,000 spend
      } as unknown as PoliticalParty;

      // Seed the three collections processPartyGOTV reads data from.
      const cursorFor = <T>(docs: T[]) => ({
        toArray: vi.fn().mockResolvedValue(docs),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });

      // Pre-initialize so collectionMocks entries exist.
      db.collection("partyBudget");
      db.collection("stateDemographicTurnout");
      db.collection("politicalParties");
      db.collection("statePartyOrg");
      db.collection("characters");
      db.collection("npps");
      db.collection("states");

      db.collectionMocks["partyBudget"]!.find.mockReturnValue(cursorFor([nationalBudget]));
      db.collectionMocks["stateDemographicTurnout"]!.find.mockReturnValue(cursorFor([mockTurnout]));
      db.collectionMocks["politicalParties"]!.find.mockReturnValue(cursorFor([mockParty]));
      db.collectionMocks["states"]!.find.mockReturnValue(
        cursorFor([{ _id: stateId, population: statePopulation }])
      );

      await processPartyGOTV();

      const bulkCalls = db.collectionMocks["politicalParties"]!.bulkWrite.mock.calls;
      expect(bulkCalls.length).toBeGreaterThan(0);
      const ops = bulkCalls[0][0] as Array<{
        updateOne: {
          filter: Record<string, unknown>;
          update: { $inc: Record<string, number> };
        };
      }>;
      const op = ops.find((o) => o.updateOne.filter.sequentialId === Number(partyId));
      expect(op).toBeDefined();
      expect(op!.updateOne.filter).toEqual({
        countryId: partyCountry,
        sequentialId: Number(partyId),
      });
      // No `slug` key — the regression.
      expect(op!.updateOne.filter).not.toHaveProperty("slug");
      // Treasury decrement is negative.
      expect(op!.updateOne.update.$inc.treasury).toBeLessThan(0);
    });

    it("derives countryId for legacy national budgets that predate country scoping", async () => {
      const db: MockDb = createMockDb();
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

      const partyId = "1";
      const partyCountry = "US";
      const stateId = "PA";

      const legacyBudget = {
        _id: new ObjectId(),
        partyId,
        scope: "national",
        gotvBudgetPerTurn: 500,
        gotvBudgetPercent: 0,
        gotvTargetCategory: "ideology",
        gotvTargetGroup: "evangelicals",
        suppressionBudgetPercent: 0,
        orgBuildingPercent: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockTurnout: StateDemographicTurnout = {
        _id: stateId,
        countryId: "US",
        modifiers: {
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
        },
        lastDecayApplied: new Date(),
        lastUpdated: new Date(),
      };

      const mockParty = {
        _id: new ObjectId(),
        sequentialId: Number(partyId),
        countryId: partyCountry,
        name: "DEM",
        economicPosition: 4,
        socialPosition: 5,
        treasury: 10_000,
      } as unknown as PoliticalParty;

      const cursorFor = <T>(docs: T[]) => ({
        toArray: vi.fn().mockResolvedValue(docs),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });

      db.collection("partyBudget");
      db.collection("stateDemographicTurnout");
      db.collection("politicalParties");
      db.collection("statePartyOrg");
      db.collection("characters");
      db.collection("npps");
      db.collection("states");

      db.collectionMocks["partyBudget"]!.find.mockReturnValue(cursorFor([legacyBudget]));
      db.collectionMocks["stateDemographicTurnout"]!.find.mockReturnValue(cursorFor([mockTurnout]));
      db.collectionMocks["politicalParties"]!.find.mockReturnValue(cursorFor([mockParty]));
      db.collectionMocks["states"]!.find.mockReturnValue(
        cursorFor([{ _id: stateId, population: 100_000 }])
      );

      await processPartyGOTV();

      expect(db.collectionMocks["partyBudget"]!.bulkWrite).toHaveBeenCalled();
      const backfillOps = db.collectionMocks["partyBudget"]!.bulkWrite.mock.calls[0][0] as Array<{
        updateOne: {
          filter: Record<string, unknown>;
          update: { $set: Record<string, unknown> };
        };
      }>;
      expect(backfillOps[0].updateOne.filter).toMatchObject({
        countryId: { $exists: false },
      });
      expect(backfillOps[0].updateOne.update.$set.countryId).toBe(partyCountry);

      const treasuryOps = db.collectionMocks["politicalParties"]!.bulkWrite.mock
        .calls[0][0] as Array<{
        updateOne: {
          filter: Record<string, unknown>;
        };
      }>;
      expect(treasuryOps[0].updateOne.filter).toEqual({
        countryId: partyCountry,
        sequentialId: Number(partyId),
      });
    });

    it("uses country-scoped national party lookup when spending percentage budgets", async () => {
      const db: MockDb = createMockDb();
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

      const partyId = "1";
      const partyCountry = "US";
      const stateId = "PA";

      const nationalBudget = {
        _id: new ObjectId(),
        partyId,
        countryId: partyCountry,
        scope: "national",
        gotvBudgetPerTurn: 0,
        gotvBudgetPercent: 10,
        gotvTargetCategory: "ideology",
        gotvTargetGroup: "evangelicals",
        suppressionBudgetPercent: 0,
        orgBuildingPercent: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as PartyBudget;

      const mockTurnout: StateDemographicTurnout = {
        _id: stateId,
        countryId: "US",
        modifiers: {
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
        },
        lastDecayApplied: new Date(),
        lastUpdated: new Date(),
      };

      const mockParty = {
        _id: new ObjectId(),
        sequentialId: Number(partyId),
        countryId: partyCountry,
        name: "DEM",
        economicPosition: 4,
        socialPosition: 5,
        nationalTaxRate: 10,
        treasury: 10_000,
      } as unknown as PoliticalParty;

      const mockCharacter = {
        _id: new ObjectId(),
        party: partyId,
        homeState: stateId,
        donorBaseLevel: 0,
        currentOffice: null,
      } as unknown as import("@/lib/db/types").Character;

      const cursorFor = <T>(docs: T[]) => ({
        toArray: vi.fn().mockResolvedValue(docs),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });

      db.collection("partyBudget");
      db.collection("stateDemographicTurnout");
      db.collection("politicalParties");
      db.collection("statePartyOrg");
      db.collection("characters");
      db.collection("npps");
      db.collection("states");

      db.collectionMocks["partyBudget"]!.find.mockReturnValue(cursorFor([nationalBudget]));
      db.collectionMocks["stateDemographicTurnout"]!.find.mockReturnValue(cursorFor([mockTurnout]));
      db.collectionMocks["politicalParties"]!.find.mockReturnValue(cursorFor([mockParty]));
      db.collectionMocks["characters"]!.find.mockReturnValue(cursorFor([mockCharacter]));
      db.collectionMocks["npps"]!.find.mockReturnValue(cursorFor([]));
      db.collectionMocks["states"]!.find.mockReturnValue(
        cursorFor([{ _id: stateId, population: 100_000 }])
      );

      await processPartyGOTV();

      const treasuryOps = db.collectionMocks["politicalParties"]!.bulkWrite.mock
        .calls[0][0] as Array<{
        updateOne: {
          filter: Record<string, unknown>;
          update: { $inc: Record<string, number> };
        };
      }>;

      expect(treasuryOps[0].updateOne.filter).toEqual({
        countryId: partyCountry,
        sequentialId: Number(partyId),
      });
      expect(treasuryOps[0].updateOne.update.$inc.treasury).toBeLessThan(0);
    });

    it("does not mix same sequential party ids across countries when computing national GOTV spend", async () => {
      const db: MockDb = createMockDb();
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

      const usStateId = "PA";
      const ukStateId = "ENG";
      const usPartyId = "2";

      const nationalBudget = {
        _id: new ObjectId(),
        partyId: usPartyId,
        countryId: "US",
        scope: "national",
        gotvBudgetPerTurn: 0,
        gotvBudgetPercent: 10,
        gotvTargetCategory: "ideology",
        gotvTargetGroup: "evangelicals",
        suppressionBudgetPercent: 0,
        orgBuildingPercent: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as PartyBudget;

      const mockTurnout: StateDemographicTurnout = {
        _id: usStateId,
        countryId: "US",
        modifiers: {
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
        },
        lastDecayApplied: new Date(),
        lastUpdated: new Date(),
      };

      const usParty = {
        _id: new ObjectId(),
        sequentialId: Number(usPartyId),
        countryId: "US",
        name: "Republican Party",
        economicPosition: 4,
        socialPosition: 5,
        nationalTaxRate: 10,
        treasury: 10_000,
      } as unknown as PoliticalParty;

      const ukParty = {
        _id: new ObjectId(),
        sequentialId: Number(usPartyId),
        countryId: "UK",
        name: "Conservative Party",
        economicPosition: 4,
        socialPosition: 5,
        nationalTaxRate: 10,
        treasury: 10_000,
      } as unknown as PoliticalParty;

      const usCharacter = {
        _id: new ObjectId(),
        party: usPartyId,
        countryId: "US",
        homeState: usStateId,
        donorBaseLevel: 0,
        currentOffice: null,
      } as unknown as import("@/lib/db/types").Character;

      const ukCharacter = {
        _id: new ObjectId(),
        party: usPartyId,
        countryId: "UK",
        homeState: ukStateId,
        donorBaseLevel: 75,
        currentOffice: { type: "commons", seats: 1 },
      } as unknown as import("@/lib/db/types").Character;

      const cursorFor = <T>(docs: T[]) => ({
        toArray: vi.fn().mockResolvedValue(docs),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });

      db.collection("partyBudget");
      db.collection("stateDemographicTurnout");
      db.collection("politicalParties");
      db.collection("statePartyOrg");
      db.collection("characters");
      db.collection("npps");
      db.collection("states");

      db.collectionMocks["partyBudget"]!.find.mockReturnValue(cursorFor([nationalBudget]));
      db.collectionMocks["stateDemographicTurnout"]!.find.mockReturnValue(cursorFor([mockTurnout]));
      db.collectionMocks["politicalParties"]!.find.mockReturnValue(cursorFor([usParty, ukParty]));
      db.collectionMocks["characters"]!.find.mockReturnValue(cursorFor([usCharacter, ukCharacter]));
      db.collectionMocks["npps"]!.find.mockReturnValue(cursorFor([]));
      db.collectionMocks["states"]!.find.mockReturnValue(
        cursorFor([
          { _id: usStateId, population: 100_000, gdp: 100_000, countryId: "US" },
          { _id: ukStateId, population: 30_000_000, gdp: 2_000_000, countryId: "UK" },
        ])
      );

      await processPartyGOTV();

      const treasuryOps = db.collectionMocks["politicalParties"]!.bulkWrite.mock
        .calls[0][0] as Array<{
        updateOne: {
          filter: Record<string, unknown>;
          update: { $inc: Record<string, number> };
        };
      }>;

      expect(treasuryOps).toHaveLength(1);
      const usSpend = Math.abs(treasuryOps[0].updateOne.update.$inc.treasury);
      expect(usSpend).toBe(75);
    });

    it("emits one national treasury row for GOTV and one for suppression instead of collapsing both into repeated state-shaped entries", async () => {
      const db: MockDb = createMockDb();
      const { getDb } = await import("@/lib/mongodb");
      vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

      const partyId = "1";
      const partyCountry = "US";
      const stateIds = ["PA", "MI"];

      const nationalBudget = {
        _id: new ObjectId(),
        partyId,
        countryId: partyCountry,
        scope: "national",
        gotvBudgetPerTurn: 600,
        gotvBudgetPercent: 0,
        gotvTargetCategory: "ideology",
        gotvTargetGroup: "evangelicals",
        suppressionBudgetPercent: 5,
        suppressionTargetCategory: "age",
        suppressionTargetGroup: "young",
        orgBuildingPercent: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as PartyBudget;

      const turnouts: StateDemographicTurnout[] = stateIds.map((stateId) => ({
        _id: stateId,
        countryId: "US",
        modifiers: {
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
        },
        lastDecayApplied: new Date(),
        lastUpdated: new Date(),
      }));

      const mockParty = {
        _id: new ObjectId(),
        sequentialId: Number(partyId),
        countryId: partyCountry,
        name: "DEM",
        economicPosition: 4,
        socialPosition: 5,
        nationalTaxRate: 10,
        treasury: 10_000,
      } as unknown as PoliticalParty;

      const mockCharacter = {
        _id: new ObjectId(),
        party: partyId,
        homeState: stateIds[0],
        donorBaseLevel: 0,
        currentOffice: null,
      } as unknown as import("@/lib/db/types").Character;

      const cursorFor = <T>(docs: T[]) => ({
        toArray: vi.fn().mockResolvedValue(docs),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });

      db.collection("partyBudget");
      db.collection("stateDemographicTurnout");
      db.collection("politicalParties");
      db.collection("statePartyOrg");
      db.collection("characters");
      db.collection("npps");
      db.collection("states");

      db.collectionMocks.partyBudget.find.mockReturnValue(cursorFor([nationalBudget]));
      db.collectionMocks.stateDemographicTurnout.find.mockReturnValue(cursorFor(turnouts));
      db.collectionMocks.politicalParties.find.mockReturnValue(cursorFor([mockParty]));
      db.collectionMocks.characters.find.mockReturnValue(cursorFor([mockCharacter]));
      db.collectionMocks.npps.find.mockReturnValue(cursorFor([]));
      db.collectionMocks.states.find.mockReturnValue(
        cursorFor(stateIds.map((stateId) => ({ _id: stateId, population: 100_000 })))
      );

      const { emitTreasuryTransaction } = await import("@/lib/treasury/emit");

      await processPartyGOTV();

      expect(emitTreasuryTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          holderType: "party",
          partyId,
          category: "gotv",
          memo: "GOTV operations",
        })
      );
      expect(emitTreasuryTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          holderType: "party",
          partyId,
          category: "suppression",
          memo: "Suppression operations",
        })
      );

      const calls = vi
        .mocked(emitTreasuryTransaction)
        .mock.calls.filter(([args]) => args.holderType === "party" && args.partyId === partyId);
      expect(calls).toHaveLength(2);
    });
  });

  describe("processPlayerCanvassing", () => {
    it("applies canvassing boost with alignment scaling", async () => {
      const mockAction = {
        characterId: new ObjectId(),
        stateId: "PA",
        demographic: { category: "age", group: "young" },
        characterPosition: { economic: -2, social: -3 },
        costFunds: 100,
        costActions: 1,
        isActiveCampaignSeason: true,
      };

      const mockTurnout: StateDemographicTurnout = {
        _id: "PA",
        modifiers: {
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
        },
        countryId: "US",
        lastDecayApplied: new Date(),
        lastUpdated: new Date(),
      };

      const result = await processPlayerCanvassing([mockAction], [mockTurnout]);

      // Young demographic should receive boost
      expect(result[0].modifiers.age.young).toBeGreaterThan(0);
      expect(result[0].modifiers.age.young).toBeLessThan(0.2); // Should be small
    });
  });
});
