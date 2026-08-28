import { describe, it, expect, vi, beforeEach } from "vitest";
import { processFundGeneration } from "./fundGeneration";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Character, State, PoliticalParty, StatePartyOrg } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/utils/fundGeneration", () => ({
  projectCharacterGeneration: vi.fn(),
  calculateTaxAmount: vi.fn(),
}));

vi.mock("@/lib/financialTxLog/emit", () => ({
  loadTxThresholds: vi.fn().mockResolvedValue({}),
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/treasury/emit", () => ({
  emitTreasuryTransactionsBulk: vi.fn().mockResolvedValue(undefined),
}));

import { getDb } from "@/lib/mongodb";
import { projectCharacterGeneration, calculateTaxAmount } from "@/lib/utils/fundGeneration";
import { emitTxBulk } from "@/lib/financialTxLog/emit";

describe("fundGeneration", () => {
  let db: MockDb;

  beforeEach(async () => {
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.clearAllMocks();
  });

  const createCharacter = (overrides?: Partial<Character>): Character =>
    ({
      _id: new ObjectId(),
      name: "Test Character",
      homeState: "US-CA",
      countryId: "US",
      party: "1",
      donorBaseLevel: 0,
      currentOffice: null,
      funds: 0,
      ...overrides,
    }) as Character;

  const createState = (id: string, population: number): State =>
    ({
      _id: id,
      name: "Test State",
      countryId: "US",
      population,
    }) as State;

  const createParty = (sequentialId: number, countryId: string = "US"): PoliticalParty =>
    ({
      _id: new ObjectId(),
      sequentialId,
      countryId,
      name: "Test Party",
      treasury: 0,
      nationalTaxRate: 0,
    }) as PoliticalParty;

  const createStatePartyOrg = (stateId: string, partyId: string): StatePartyOrg =>
    ({
      _id: `${stateId}_${partyId}`,
      stateId,
      partyId,
      treasury: 0,
      stateTaxRate: 0,
    }) as StatePartyOrg;

  /**
   * Helper to set up a collection mock with a find() that returns given data.
   */
  function setupCollection<T>(name: string, data: T[]) {
    db.collection(name);
    db.collectionMocks[name]!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(data),
    });
  }

  describe("processFundGeneration", () => {
    it("returns zero totals when no characters provided", async () => {
      setupCollection<Character>("characters", []);

      const result = await processFundGeneration([], new Date());

      expect(result).toEqual({
        totalGenerated: 0,
        totalStateTaxes: 0,
        totalNationalTaxes: 0,
      });
      expect(db.collectionMocks["characters"]!.bulkWrite).not.toHaveBeenCalled();
    });

    it("skips characters with invalid home state", async () => {
      const character = createCharacter({ homeState: "INVALID" });
      setupCollection<State>("states", []);

      const result = await processFundGeneration([character], new Date());

      expect(result.totalGenerated).toBe(0);
    });

    it("gives full funds to independent characters (no taxes)", async () => {
      const character = createCharacter({ party: "independent" });
      const state = createState("US-CA", 100000);

      vi.mocked(projectCharacterGeneration).mockReturnValue(1000);

      setupCollection<State>("states", [state]);
      setupCollection<PoliticalParty>("politicalParties", []);
      setupCollection<StatePartyOrg>("statePartyOrg", []);

      const result = await processFundGeneration([character], new Date());

      expect(result.totalGenerated).toBe(1000);
      expect(result.totalStateTaxes).toBe(0);
      expect(result.totalNationalTaxes).toBe(0);
      expect(db.collectionMocks["characters"]!.bulkWrite).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            updateOne: expect.objectContaining({
              update: { $inc: { funds: 1000 } },
            }),
          }),
        ])
      );
    });

    it("applies state and national taxes for party members", async () => {
      const character = createCharacter({ party: "1", countryId: "US" });
      const state = createState("US-CA", 100000);
      const party = createParty(1, "US");
      party.nationalTaxRate = 10; // 10%
      const statePartyOrg = createStatePartyOrg("US-CA", "1");
      statePartyOrg.stateTaxRate = 5; // 5%

      vi.mocked(projectCharacterGeneration).mockReturnValue(1000);
      vi.mocked(calculateTaxAmount).mockImplementation((amount, rate) =>
        Math.floor(amount * (rate / 100))
      );

      setupCollection<State>("states", [state]);
      setupCollection<PoliticalParty>("politicalParties", [party]);
      setupCollection<StatePartyOrg>("statePartyOrg", [statePartyOrg]);

      const result = await processFundGeneration([character], new Date());

      expect(result.totalGenerated).toBe(1000);
      expect(result.totalStateTaxes).toBeGreaterThan(0);
      expect(result.totalNationalTaxes).toBeGreaterThan(0);
    });

    it("uses preloaded state map when provided", async () => {
      const character = createCharacter();
      const state = createState("US-CA", 100000);
      const preloadedStateMap = new Map([["US-CA", state]]);

      vi.mocked(projectCharacterGeneration).mockReturnValue(500);

      const result = await processFundGeneration([character], new Date(), preloadedStateMap);

      expect(result.totalGenerated).toBe(500);
      // Should not query states collection when preloaded
      expect(db.collection).not.toHaveBeenCalledWith("states");
    });

    it("handles multiple characters with different parties", async () => {
      const char1 = createCharacter({ _id: new ObjectId(), party: "1" });
      const char2 = createCharacter({ _id: new ObjectId(), party: "2" });
      const char3 = createCharacter({ _id: new ObjectId(), party: "independent" });

      const state = createState("US-CA", 100000);
      const party1 = createParty(1, "US");
      const party2 = createParty(2, "US");
      const statePartyOrg1 = createStatePartyOrg("US-CA", "1");
      const statePartyOrg2 = createStatePartyOrg("US-CA", "2");

      vi.mocked(projectCharacterGeneration).mockReturnValue(1000);
      vi.mocked(calculateTaxAmount).mockReturnValue(100);

      setupCollection<State>("states", [state]);
      setupCollection<PoliticalParty>("politicalParties", [party1, party2]);
      setupCollection<StatePartyOrg>("statePartyOrg", [statePartyOrg1, statePartyOrg2]);

      const result = await processFundGeneration([char1, char2, char3], new Date());

      expect(result.totalGenerated).toBe(3000); // 1000 * 3
      expect(db.collectionMocks["characters"]!.bulkWrite).toHaveBeenCalled();
      expect(db.collectionMocks["politicalParties"]!.bulkWrite).toHaveBeenCalled();
      expect(db.collectionMocks["statePartyOrg"]!.bulkWrite).toHaveBeenCalled();
    });

    it("handles missing party (defaults to 0% national tax)", async () => {
      const character = createCharacter({ party: "999" });
      const state = createState("US-CA", 100000);

      vi.mocked(projectCharacterGeneration).mockReturnValue(1000);
      vi.mocked(calculateTaxAmount).mockReturnValue(0);

      setupCollection<State>("states", [state]);
      setupCollection<PoliticalParty>("politicalParties", []);
      setupCollection<StatePartyOrg>("statePartyOrg", []);

      const result = await processFundGeneration([character], new Date());

      expect(result.totalNationalTaxes).toBe(0);
    });

    it("handles missing state party org (defaults to 0% state tax)", async () => {
      const character = createCharacter({ party: "1" });
      const state = createState("US-CA", 100000);
      const party = createParty(1, "US");

      vi.mocked(projectCharacterGeneration).mockReturnValue(1000);
      vi.mocked(calculateTaxAmount).mockReturnValue(0);

      setupCollection<State>("states", [state]);
      setupCollection<PoliticalParty>("politicalParties", [party]);
      setupCollection<StatePartyOrg>("statePartyOrg", []);

      const result = await processFundGeneration([character], new Date());

      expect(result.totalStateTaxes).toBe(0);
    });

    it("updates national party treasury with tax amounts", async () => {
      const character = createCharacter({ party: "1" });
      const state = createState("US-CA", 100000);
      const party = createParty(1, "US");
      const statePartyOrg = createStatePartyOrg("US-CA", "1");

      vi.mocked(projectCharacterGeneration).mockReturnValue(1000);
      vi.mocked(calculateTaxAmount).mockReturnValueOnce(100);
      vi.mocked(calculateTaxAmount).mockReturnValueOnce(150);

      setupCollection<State>("states", [state]);
      setupCollection<PoliticalParty>("politicalParties", [party]);
      setupCollection<StatePartyOrg>("statePartyOrg", [statePartyOrg]);

      await processFundGeneration([character], new Date());

      expect(db.collectionMocks["politicalParties"]!.bulkWrite).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            updateOne: expect.objectContaining({
              filter: expect.objectContaining({ _id: expect.any(ObjectId) }),
              update: expect.objectContaining({
                $inc: { treasury: 150 },
              }),
            }),
          }),
        ])
      );
    });

    it("records party taxes as party dues and waits for the ledger write", async () => {
      const character = createCharacter({ party: "1" });
      const state = createState("US-CA", 100000);
      const party = createParty(1, "US");
      party.nationalTaxRate = 10;
      const statePartyOrg = createStatePartyOrg("US-CA", "1");
      statePartyOrg.countryId = "US";
      statePartyOrg.stateTaxRate = 5;

      vi.mocked(projectCharacterGeneration).mockReturnValue(1000);
      vi.mocked(calculateTaxAmount).mockReturnValueOnce(50).mockReturnValueOnce(100);
      setupCollection<State>("states", [state]);
      setupCollection<PoliticalParty>("politicalParties", [party]);
      setupCollection<StatePartyOrg>("statePartyOrg", [statePartyOrg]);

      let releaseEmission: (() => void) | undefined;
      vi.mocked(emitTxBulk).mockReturnValue(
        new Promise<void>((resolve) => {
          releaseEmission = resolve;
        })
      );

      let phaseFinished = false;
      const processing = processFundGeneration([character], new Date(), undefined, true, 91).then(
        (result) => {
          phaseFinished = true;
          return result;
        }
      );

      await vi.waitFor(() => expect(emitTxBulk).toHaveBeenCalledOnce());
      const entries = vi.mocked(emitTxBulk).mock.calls[0]![1];
      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "party_dues_received",
            subjectType: "party",
            subjectId: party._id,
            amount: 100,
          }),
          expect.objectContaining({
            type: "party_dues_received",
            subjectType: "party",
            amount: 50,
            meta: expect.objectContaining({ statePartyKey: "US-CA_1" }),
          }),
        ])
      );
      expect(entries.some((row) => row.type === "gov_tax_revenue")).toBe(false);
      await Promise.resolve();
      expect(phaseFinished).toBe(false);

      releaseEmission?.();
      await processing;
    });

    it("updates state party treasury with tax amounts", async () => {
      const character = createCharacter({ party: "1" });
      const state = createState("US-CA", 100000);
      const party = createParty(1, "US");
      const statePartyOrg = createStatePartyOrg("US-CA", "1");

      vi.mocked(projectCharacterGeneration).mockReturnValue(1000);
      vi.mocked(calculateTaxAmount).mockReturnValueOnce(100);
      vi.mocked(calculateTaxAmount).mockReturnValueOnce(0);

      setupCollection<State>("states", [state]);
      setupCollection<PoliticalParty>("politicalParties", [party]);
      setupCollection<StatePartyOrg>("statePartyOrg", [statePartyOrg]);

      await processFundGeneration([character], new Date());

      expect(db.collectionMocks["statePartyOrg"]!.bulkWrite).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            updateOne: expect.objectContaining({
              filter: { _id: "US-CA_1" },
              update: expect.objectContaining({
                $inc: { treasury: 100 },
              }),
            }),
          }),
        ])
      );
    });

    it("aggregates taxes from multiple characters for same party", async () => {
      const char1 = createCharacter({ _id: new ObjectId(), party: "1" });
      const char2 = createCharacter({ _id: new ObjectId(), party: "1" });
      const state = createState("US-CA", 100000);
      const party = createParty(1, "US");
      party.nationalTaxRate = 5; // 5%
      const statePartyOrg = createStatePartyOrg("US-CA", "1");
      statePartyOrg.stateTaxRate = 10; // 10%

      vi.mocked(projectCharacterGeneration).mockReturnValue(1000);
      vi.mocked(calculateTaxAmount).mockImplementation((amount, rate) =>
        Math.floor(amount * (rate / 100))
      );
      // 10% of 1000 = 100 state tax, 5% of 1000 = 50 national tax per character

      setupCollection<State>("states", [state]);
      setupCollection<PoliticalParty>("politicalParties", [party]);
      setupCollection<StatePartyOrg>("statePartyOrg", [statePartyOrg]);

      const result = await processFundGeneration([char1, char2], new Date());

      expect(result.totalStateTaxes).toBe(200); // 100 * 2
      expect(result.totalNationalTaxes).toBe(100); // 50 * 2
    });

    it("credits office income at the frozen INITIAL_RATES local scale (US ×1.0)", async () => {
      // #0553 guard: the US initial rate is 1.0, so the local credit equals the
      // anchor generation — no live-forex multiplication, no compounding drift.
      // (Campaign funds are decoupled from live forex; conversion uses the frozen
      // INITIAL_RATES scale via campaignAnchorToLocal, which is US ×1.0.)
      const character = createCharacter({ party: "independent", countryId: "US" });
      const state = createState("US-CA", 100000);

      vi.mocked(projectCharacterGeneration).mockReturnValue(17_500);

      setupCollection<State>("states", [state]);
      setupCollection<PoliticalParty>("politicalParties", []);
      setupCollection<StatePartyOrg>("statePartyOrg", []);

      await processFundGeneration([character], new Date(), undefined, true, 0);

      const bulkWriteCall = db.collectionMocks["characters"]!.bulkWrite.mock.calls[0]?.[0] as
        { updateOne: { update: { $inc: Record<string, number> } } }[] | undefined;
      expect(bulkWriteCall).toBeDefined();
      const inc = bulkWriteCall![0]!.updateOne.update.$inc;
      expect(inc).toEqual({ "currencyBalances.campaign": 17_500 });
      expect(inc).not.toHaveProperty("funds");
    });

    it("scales office income to local for a non-USD country (NG ×1550)", async () => {
      // NG's frozen initial rate is 1550 local-per-anchor. The anchor generation
      // must be denominated to local before crediting the (local) campaign field,
      // otherwise the player receives 1/1550th of intended (the reported bug).
      const character = createCharacter({
        _id: new ObjectId(),
        party: "independent",
        countryId: "NG",
        homeState: "NG-SW",
      });
      const state = createState("NG-SW", 17_000_000);

      vi.mocked(projectCharacterGeneration).mockReturnValue(38_122);

      setupCollection<State>("states", [state]);
      setupCollection<PoliticalParty>("politicalParties", []);
      setupCollection<StatePartyOrg>("statePartyOrg", []);

      await processFundGeneration([character], new Date(), undefined, true, 0);

      const bulkWriteCall = db.collectionMocks["characters"]!.bulkWrite.mock.calls[0]?.[0] as
        { updateOne: { update: { $inc: Record<string, number> } } }[] | undefined;
      expect(bulkWriteCall).toBeDefined();
      const inc = bulkWriteCall![0]!.updateOne.update.$inc;
      expect(inc).toEqual({ "currencyBalances.campaign": Math.round(38_122 * 1550) });
    });

    it("handles characters from different countries", async () => {
      const usChar = createCharacter({ _id: new ObjectId(), countryId: "US", party: "1" });
      const ukChar = createCharacter({
        _id: new ObjectId(),
        countryId: "UK",
        homeState: "UK-LDN",
        party: "2",
      });

      const usState = createState("US-CA", 100000);
      const ukState = createState("UK-LDN", 50000);
      const usParty = createParty(1, "US");
      const ukParty = createParty(2, "UK");

      vi.mocked(projectCharacterGeneration).mockReturnValue(1000);
      vi.mocked(calculateTaxAmount).mockReturnValue(100);

      setupCollection<State>("states", [usState, ukState]);
      setupCollection<PoliticalParty>("politicalParties", [usParty, ukParty]);
      setupCollection<StatePartyOrg>("statePartyOrg", []);

      const result = await processFundGeneration([usChar, ukChar], new Date());

      // Each character's anchor generation (1000) is denominated to its own
      // frozen local rate: US ×1.0 = 1000, UK ×0.75 = 750. totalGenerated
      // accumulates the local amounts.
      expect(result.totalGenerated).toBe(1000 + Math.round(1000 * 0.75));
    });
  });
});
