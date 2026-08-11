import { describe, it, expect, vi, beforeEach } from "vitest";
import { processNppActions, NPP_ACTIONS_PER_CYCLE } from "./nppActionProcessing";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { NPP } from "@/lib/db/types/npp";

// Campaign's cost helpers are re-exported real (not stubbed): they're pure
// tier lookups (`getCampaignActionCost` from @/lib/actions, itself unmocked)
// and the actual escalating-cost behavior under test needs the real ladder,
// not a flat stand-in.
vi.mock("@/lib/npp/actionAi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/npp/actionAi")>("@/lib/npp/actionAi");
  return {
    ...actual,
    decideNppAction: vi.fn(),
  };
});

import { decideNppAction } from "@/lib/npp/actionAi";

describe("nppActionProcessing", () => {
  let mockDb: Db;
  let mockBulkWrite: ReturnType<typeof vi.fn>;
  let mockFindOne: ReturnType<typeof vi.fn>;
  let mockNppFind: ReturnType<typeof vi.fn>;
  let mockPartyFind: ReturnType<typeof vi.fn>;

  function createAsyncCursor(items: any[]) {
    // Chainable so callers using .sort()/.limit()/.toArray() (e.g. the
    // found-corp sweep's "N wealthiest NPPs" query) work the same as callers
    // using `for await` (e.g. the main action loop) against one shared mock.
    let ordered = items;
    const cursor = {
      [Symbol.asyncIterator]: async function* () {
        for (const item of ordered) {
          yield item;
        }
      },
      sort(spec: Record<string, 1 | -1>) {
        const [field, dir] = Object.entries(spec)[0] ?? [];
        if (field) {
          ordered = [...ordered].sort((a, b) => {
            const av = a[field];
            const bv = b[field];
            return av < bv ? -1 * (dir ?? 1) : av > bv ? 1 * (dir ?? 1) : 0;
          });
        }
        return cursor;
      },
      limit(n: number) {
        ordered = ordered.slice(0, n);
        return cursor;
      },
      toArray: async () => ordered,
    };
    return cursor;
  }

  beforeEach(() => {
    mockBulkWrite = vi.fn();
    mockFindOne = vi.fn();
    mockNppFind = vi.fn();
    mockPartyFind = vi.fn();

    mockDb = {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "gameConfig") {
          return { findOne: mockFindOne };
        }
        if (name === "npps") {
          return {
            find: mockNppFind,
            bulkWrite: mockBulkWrite,
          };
        }
        if (name === "politicalParties") {
          return {
            find: mockPartyFind,
            bulkWrite: mockBulkWrite,
          };
        }
        return {
          find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          bulkWrite: mockBulkWrite,
          findOne: mockFindOne,
        };
      }),
    } as unknown as Db;

    vi.clearAllMocks();

    // Defaults so every test gets a usable cursor without opting in. The
    // politicalParties load is unconditional now (it feeds both the treasury
    // flush and the v3+ party-finance decision signal), so a test that doesn't
    // care about parties still has to get an empty result rather than undefined.
    mockPartyFind.mockReturnValue(createAsyncCursor([]));
    mockNppFind.mockReturnValue(createAsyncCursor([]));
  });

  describe("processNppActions", () => {
    const createNpp = (overrides?: Partial<NPP>): NPP =>
      ({
        _id: new ObjectId(),
        name: "Test NPP",
        countryId: "US" as const,
        party: "party-1",
        personality: { loyalty: 50, ambition: 50 },
        funds: 100_000,
        actionPoints: 10,
        donorBaseLevel: 0,
        currentOffice: null,
        retiredAt: null,
        favorability: 0,
        politicalInfluence: 0,
        ...overrides,
      }) as NPP;

    const createParty = (sequentialId: number, countryId: string = "US") => ({
      _id: new ObjectId(),
      sequentialId,
      countryId,
      name: "Test Party",
      treasury: 0,
    });

    it("returns zero result when turn is not divisible by 4", async () => {
      const result = await processNppActions(mockDb, 5);

      expect(result).toEqual({
        nppsProcessed: 0,
        actionsExecuted: 0,
        buildDonorBase: 0,
        campaign: 0,
        advertise: 0,
        partyDonation: 0,
        fundraise: 0,
        skipped: 0,
      });
    });

    it("returns zero result when NPP economy is disabled", async () => {
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: false });

      const result = await processNppActions(mockDb, 4);

      expect(result).toEqual({
        nppsProcessed: 0,
        actionsExecuted: 0,
        buildDonorBase: 0,
        campaign: 0,
        advertise: 0,
        partyDonation: 0,
        fundraise: 0,
        skipped: 0,
      });
    });

    it("returns zero result when no NPPs have action points", async () => {
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      (mockDb.collection("npps").find as ReturnType<typeof vi.fn>).mockReturnValue(
        createAsyncCursor([])
      );

      const result = await processNppActions(mockDb, 4);

      expect(result).toEqual({
        nppsProcessed: 0,
        actionsExecuted: 0,
        buildDonorBase: 0,
        campaign: 0,
        advertise: 0,
        partyDonation: 0,
        fundraise: 0,
        skipped: 0,
      });
    });

    it("processes campaign action", async () => {
      vi.mocked(decideNppAction)
        .mockReturnValueOnce({ action: "campaign", reason: "Testing" })
        .mockReturnValue({ action: "none", reason: "done" });

      const npp = createNpp();
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      mockNppFind.mockReturnValue(createAsyncCursor([npp]));

      const result = await processNppActions(mockDb, 4);

      expect(result.nppsProcessed).toBe(1);
      expect(result.actionsExecuted).toBe(1);
      expect(result.campaign).toBe(1);
      expect(mockBulkWrite).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            updateOne: expect.objectContaining({
              update: expect.objectContaining({
                // Tier 1 (influence 0, < 20): 1 AP / $5,000 — the same 1-5
                // escalating ladder the player faces via getCampaignActionCost.
                $inc: expect.objectContaining({
                  actionPoints: -1,
                  funds: -5_000,
                }),
                $set: expect.objectContaining({
                  politicalInfluence: 1,
                }),
              }),
            }),
          }),
        ])
      );
    });

    it("fires the funds-poor fallback (fundraise): a cash-poor, AP-rich NPP takes SOME action instead of idling forever", async () => {
      // Trap 1: before the fundraise fallback, an NPP with plenty of AP but funds below
      // every action's cost got "none" every single cycle, forever — it never took any
      // action of any kind. decideNppAction now returns "fundraise" as a last resort;
      // this proves processNppActions actually executes it (credits funds, spends AP,
      // counts it) rather than treating it like "none".
      vi.mocked(decideNppAction)
        .mockReturnValueOnce({ action: "fundraise", reason: "Cash-poor fallback" })
        .mockReturnValue({ action: "none", reason: "done" });

      const npp = createNpp({ funds: 0, actionPoints: 90 });
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      mockNppFind.mockReturnValue(createAsyncCursor([npp]));

      const result = await processNppActions(mockDb, 4);

      expect(result.actionsExecuted).toBe(1);
      expect(result.fundraise).toBe(1);
      expect(result.skipped).toBe(0);
      const op = mockBulkWrite.mock.calls[0][0][0];
      // Funds increase (a credit, not a spend) and AP decreases by the fundraise cost.
      expect(op.updateOne.update.$inc.funds).toBeGreaterThan(0);
      expect(op.updateOne.update.$inc.actionPoints).toBeLessThan(0);
    });

    it("uses the frozen campaignLocalRate for a non-USD NPP's cost conversion, not a live/unmocked fx rate", async () => {
      // Trap 1's currency dimension: processNppFundGeneration credits npp.funds by
      // converting anchor generation to local at the FROZEN campaignLocalRate (AT =
      // 13.4, from INITIAL_RATES). The decision-time conversion back to anchor for cost
      // gating must use the identical rate — otherwise a live/era-mismatched rate silently
      // rescales the NPP's perceived purchasing power (confirmed against a 1953-era world
      // where AT's live rate ~26 sat at roughly double the frozen 13.4, understating
      // spendable funds by ~2x). This NPP's funds (40,200 local ATS) are exactly 3,000
      // anchor at the frozen rate (advertise's cost) and would read as only ~1,527 anchor
      // — unaffordable — at the live ~26 rate this test's mockDb never even provides.
      vi.mocked(decideNppAction)
        .mockReturnValueOnce({ action: "advertise", reason: "Testing" })
        .mockReturnValue({ action: "none", reason: "done" });

      const npp = createNpp({ countryId: "AT", funds: 3_000 * 13.4 });
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      mockNppFind.mockReturnValue(createAsyncCursor([npp]));

      const result = await processNppActions(mockDb, 4);

      expect(result.advertise).toBe(1);
      const op = mockBulkWrite.mock.calls[0][0][0];
      expect(op.updateOne.update.$inc.funds).toBeCloseTo(-3_000 * 13.4, 5);
      // decideNppAction must have been called with funds already converted to anchor.
      expect(vi.mocked(decideNppAction).mock.calls[0][0].funds).toBeCloseTo(3_000, 5);
    });

    it("v3: campaign surplus stays in funds — NO savings sweep (campaign/economy wall)", async () => {
      vi.mocked(decideNppAction)
        .mockReturnValueOnce({ action: "campaign", reason: "Testing" })
        .mockReturnValue({ action: "none", reason: "done" });

      // Campaign money is walled off from the personal economy: one campaign
      // spends 5,000 local → funds $inc = -5,000, and NOTHING is swept into
      // personal savings (the funds→savings launder was removed).
      const npp = createNpp();
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true, nppAutonomyLevel: "v3" });
      mockNppFind.mockReturnValue(createAsyncCursor([npp]));

      await processNppActions(mockDb, 4);

      const op = mockBulkWrite.mock.calls[0][0][0];
      expect(op.updateOne.update.$inc.funds).toBe(-5_000);
      expect(op.updateOne.update.$inc).not.toHaveProperty("currencyBalances.savings.USD");
    });

    it("does NOT sweep to savings below v3 either (funds inc excludes savings)", async () => {
      vi.mocked(decideNppAction)
        .mockReturnValueOnce({ action: "campaign", reason: "Testing" })
        .mockReturnValue({ action: "none", reason: "done" });

      const npp = createNpp();
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true, nppAutonomyLevel: "v2" });
      mockNppFind.mockReturnValue(createAsyncCursor([npp]));

      await processNppActions(mockDb, 4);

      const op = mockBulkWrite.mock.calls[0][0][0];
      expect(op.updateOne.update.$inc.funds).toBe(-5_000);
      expect(op.updateOne.update.$inc).not.toHaveProperty("currencyBalances.savings.USD");
    });

    it("processes advertise action", async () => {
      vi.mocked(decideNppAction)
        .mockReturnValueOnce({ action: "advertise", reason: "Testing" })
        .mockReturnValue({ action: "none", reason: "done" });

      const npp = createNpp();
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      mockNppFind.mockReturnValue(createAsyncCursor([npp]));

      const result = await processNppActions(mockDb, 4);

      expect(result.nppsProcessed).toBe(1);
      expect(result.actionsExecuted).toBe(1);
      expect(result.advertise).toBe(1);
      expect(mockBulkWrite).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            updateOne: expect.objectContaining({
              update: expect.objectContaining({
                $inc: expect.objectContaining({
                  actionPoints: -2,
                  funds: -3_000,
                }),
                $set: expect.objectContaining({
                  favorability: 3,
                }),
              }),
            }),
          }),
        ])
      );
    });

    it("campaign grants the full player-rate +1.0 influence per action below the 50% diminishing-returns threshold", async () => {
      vi.mocked(decideNppAction)
        .mockReturnValueOnce({ action: "campaign", reason: "1" })
        .mockReturnValueOnce({ action: "campaign", reason: "2" })
        .mockReturnValue({ action: "none", reason: "done" });

      const npp = createNpp({ politicalInfluence: 0 });
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      mockNppFind.mockReturnValue(createAsyncCursor([npp]));

      const result = await processNppActions(mockDb, 4);

      expect(result.campaign).toBe(2);
      const set = mockBulkWrite.mock.calls[0][0][0].updateOne.update.$set;
      // Below campaignInfluenceGain's 50-point threshold the penalty is 0, so
      // both actions still land the full base +1.0, same as the old flat rate.
      expect(set.politicalInfluence).toBe(2); // 2 × +1.0
    });

    it("advertise grants the full player base +3 favorability below 70%", async () => {
      vi.mocked(decideNppAction)
        .mockReturnValueOnce({ action: "advertise", reason: "1" })
        .mockReturnValue({ action: "none", reason: "done" });

      const npp = createNpp({ favorability: 50 });
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      mockNppFind.mockReturnValue(createAsyncCursor([npp]));

      await processNppActions(mockDb, 4);

      const set = mockBulkWrite.mock.calls[0][0][0].updateOne.update.$set;
      expect(set.favorability).toBe(53); // 50 + 3
    });

    it("advertise applies the same >70% diminishing returns players get", async () => {
      vi.mocked(decideNppAction)
        .mockReturnValueOnce({ action: "advertise", reason: "1" })
        .mockReturnValue({ action: "none", reason: "done" });

      const npp = createNpp({ favorability: 80 });
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      mockNppFind.mockReturnValue(createAsyncCursor([npp]));

      await processNppActions(mockDb, 4);

      // gain = max(1, floor(3 - (80-70)*0.1)) = floor(2) = 2 → 82
      const set = mockBulkWrite.mock.calls[0][0][0].updateOne.update.$set;
      expect(set.favorability).toBe(82);
    });

    it("advertise taxes each ad in a multi-ad cycle sequentially", async () => {
      vi.mocked(decideNppAction)
        .mockReturnValueOnce({ action: "advertise", reason: "1" })
        .mockReturnValueOnce({ action: "advertise", reason: "2" })
        .mockReturnValueOnce({ action: "advertise", reason: "3" })
        .mockReturnValue({ action: "none", reason: "done" });

      const npp = createNpp({ favorability: 68 });
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      mockNppFind.mockReturnValue(createAsyncCursor([npp]));

      const result = await processNppActions(mockDb, 4);

      // 68 →(+3)→ 71 →(+2)→ 73 →(+2)→ 75 (DR recomputed from the running value)
      expect(result.advertise).toBe(3);
      const set = mockBulkWrite.mock.calls[0][0][0].updateOne.update.$set;
      expect(set.favorability).toBe(75);
    });

    it("advertise never drops below the +1 floor at very high favorability", async () => {
      vi.mocked(decideNppAction)
        .mockReturnValueOnce({ action: "advertise", reason: "1" })
        .mockReturnValue({ action: "none", reason: "done" });

      const npp = createNpp({ favorability: 95 });
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      mockNppFind.mockReturnValue(createAsyncCursor([npp]));

      await processNppActions(mockDb, 4);

      // gain = max(1, floor(3 - 2.5)) = max(1, 0) = 1 → 96
      const set = mockBulkWrite.mock.calls[0][0][0].updateOne.update.$set;
      expect(set.favorability).toBe(96);
    });

    it("processes buildDonorBase action", async () => {
      vi.mocked(decideNppAction)
        .mockReturnValueOnce({ action: "buildDonorBase", reason: "Testing" })
        .mockReturnValue({ action: "none", reason: "done" });

      const npp = createNpp({ donorBaseLevel: 0 });
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      mockNppFind.mockReturnValue(createAsyncCursor([npp]));

      const result = await processNppActions(mockDb, 4);

      expect(result.nppsProcessed).toBe(1);
      expect(result.actionsExecuted).toBe(1);
      expect(result.buildDonorBase).toBe(1);
      expect(mockBulkWrite).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            updateOne: expect.objectContaining({
              update: {
                $inc: {
                  actionPoints: -5,
                  funds: -10_000,
                },
                $set: { donorBaseLevel: 1 },
              },
            }),
          }),
        ])
      );
    });

    it("processes partyDonation action and updates party treasury", async () => {
      vi.mocked(decideNppAction)
        .mockReturnValueOnce({ action: "partyDonation", reason: "Testing" })
        .mockReturnValue({ action: "none", reason: "done" });

      const partyId = new ObjectId();
      const npp = createNpp({ party: "1" });
      const party = createParty(1);

      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      mockNppFind.mockReturnValue(createAsyncCursor([npp]));
      mockPartyFind.mockReturnValue({
        toArray: vi
          .fn()
          .mockResolvedValue([{ ...party, sequentialId: 1, countryId: "US", _id: partyId }]),
      });

      const result = await processNppActions(mockDb, 4);

      expect(result.nppsProcessed).toBe(1);
      expect(result.actionsExecuted).toBe(1);
      expect(result.partyDonation).toBe(1);
      expect(mockBulkWrite).toHaveBeenCalledTimes(2);
    });

    it("skips NPPs that choose none action", async () => {
      vi.mocked(decideNppAction).mockReturnValue({
        action: "none",
        reason: "No affordable action",
      });

      const npp = createNpp();
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      mockNppFind.mockReturnValue(createAsyncCursor([npp]));

      const result = await processNppActions(mockDb, 4);

      expect(result.nppsProcessed).toBe(1);
      expect(result.actionsExecuted).toBe(0);
      expect(result.skipped).toBe(1);
      expect(mockBulkWrite).not.toHaveBeenCalled();
    });

    it("handles multiple NPPs with different actions", async () => {
      vi.mocked(decideNppAction)
        .mockReturnValueOnce({ action: "campaign", reason: "First NPP" })
        .mockReturnValueOnce({ action: "none", reason: "done" })
        .mockReturnValueOnce({ action: "advertise", reason: "Second NPP" })
        .mockReturnValueOnce({ action: "none", reason: "done" })
        .mockReturnValueOnce({ action: "none", reason: "Third NPP" });

      const npp1 = createNpp({ _id: new ObjectId(), name: "NPP 1" } as Partial<NPP>);
      const npp2 = createNpp({ _id: new ObjectId(), name: "NPP 2" } as Partial<NPP>);
      const npp3 = createNpp({ _id: new ObjectId(), name: "NPP 3" } as Partial<NPP>);

      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      mockNppFind.mockReturnValue(createAsyncCursor([npp1, npp2, npp3]));

      const result = await processNppActions(mockDb, 4);

      expect(result.nppsProcessed).toBe(3);
      expect(result.actionsExecuted).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.campaign).toBe(1);
      expect(result.advertise).toBe(1);
    });

    it("handles NPPs with insufficient funds", async () => {
      vi.mocked(decideNppAction).mockReturnValue({
        action: "none",
        reason: "Insufficient funds",
      });

      const npp = createNpp({ funds: 0 } as Partial<NPP>);
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      mockNppFind.mockReturnValue(createAsyncCursor([npp]));

      const result = await processNppActions(mockDb, 4);

      expect(result.nppsProcessed).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it("handles retired NPPs (excludes them from query)", async () => {
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      (mockDb.collection("npps").find as ReturnType<typeof vi.fn>).mockReturnValue(
        createAsyncCursor([])
      );

      await processNppActions(mockDb, 4);

      const findCall = (mockDb.collection("npps").find as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(findCall).toEqual({
        retiredAt: null,
        actionPoints: { $gte: 1 },
        // Technocrat NPPs (autonomous CB chairs) are excluded from the political
        // action loop at the query layer (SP1 technocrat exclusion).
        isTechnocrat: { $ne: true },
      });
    });

    it("does not update party treasury for independent NPPs", async () => {
      vi.mocked(decideNppAction)
        .mockReturnValueOnce({ action: "partyDonation", reason: "Testing" })
        .mockReturnValue({ action: "none", reason: "done" });

      const npp = createNpp({ party: "independent" } as Partial<NPP>);
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      mockNppFind.mockReturnValue(createAsyncCursor([npp]));

      const result = await processNppActions(mockDb, 4);

      expect(result.partyDonation).toBe(1);
      // Should only call bulkWrite once (for NPP updates), not for party treasury
      expect(mockBulkWrite).toHaveBeenCalledTimes(1);
    });

    it("takes multiple actions per cycle until AP runs low (repeats allowed)", async () => {
      // Always-campaign mock, NPP already at influence 65 (tier 4 of the 1-5
      // escalating ladder: 60-79 costs 4 AP / $20,000). With AP=10, 2 actions
      // fit (10→6→2), the 3rd is unaffordable (2 < 4).
      vi.mocked(decideNppAction).mockReturnValue({ action: "campaign", reason: "t" });

      const npp = createNpp({ actionPoints: 10, funds: 1_000_000, politicalInfluence: 65 });
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      mockNppFind.mockReturnValue(createAsyncCursor([npp]));

      const result = await processNppActions(mockDb, 4);

      expect(result.nppsProcessed).toBe(1);
      expect(result.actionsExecuted).toBe(2);
      expect(result.campaign).toBe(2);
      const op = mockBulkWrite.mock.calls[0][0][0];
      expect(op.updateOne.update.$inc.actionPoints).toBe(-8);
      expect(op.updateOne.update.$inc.funds).toBe(-40_000);
      // campaignInfluenceGain(65) = 1 - (65-50)/75 = 0.8 → 65.8;
      // campaignInfluenceGain(65.8) = 1 - (65.8-50)/75 ≈ 0.78933 → ≈66.58933.
      expect(op.updateOne.update.$set.politicalInfluence).toBeCloseTo(66.58933, 4);
    });

    it("never exceeds NPP_ACTIONS_PER_CYCLE even with abundant AP and funds", async () => {
      // advertise costs 2 AP; AP=100 could fund 50 actions but the cap is 4.
      vi.mocked(decideNppAction).mockReturnValue({ action: "advertise", reason: "t" });

      const npp = createNpp({ actionPoints: 100, funds: 10_000_000, favorability: 0 });
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      mockNppFind.mockReturnValue(createAsyncCursor([npp]));

      const result = await processNppActions(mockDb, 4);

      expect(result.actionsExecuted).toBe(NPP_ACTIONS_PER_CYCLE);
      expect(result.advertise).toBe(NPP_ACTIONS_PER_CYCLE);
      expect(mockBulkWrite).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            updateOne: expect.objectContaining({
              update: expect.objectContaining({
                $inc: expect.objectContaining({ actionPoints: -8 }), // 4 * 2
                $set: expect.objectContaining({ favorability: 12 }), // 0→3→6→9→12 (all below 70% DR)
              }),
            }),
          }),
        ])
      );
    });

    it("clamps stacked favorability/influence at 100", async () => {
      vi.mocked(decideNppAction).mockReturnValue({ action: "advertise", reason: "t" });

      const npp = createNpp({ actionPoints: 100, funds: 10_000_000, favorability: 99 });
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      mockNppFind.mockReturnValue(createAsyncCursor([npp]));

      await processNppActions(mockDb, 4);

      expect(mockBulkWrite).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            updateOne: expect.objectContaining({
              update: expect.objectContaining({
                $set: expect.objectContaining({ favorability: 100 }), // min(100, 99 + 4*1.5)
              }),
            }),
          }),
        ])
      );
    });

    it("escalates buildDonorBase cost across repeated builds in one cycle", async () => {
      vi.mocked(decideNppAction).mockReturnValue({ action: "buildDonorBase", reason: "t" });

      // Start at level 0: build costs go 5 AP/10k (L0) then 10 AP/25k (L1) ...
      // AP=20 funds=1,000,000 → L0(5/10k) + L1(10/25k) = 15 AP used, L2(15 AP) unaffordable (5 left).
      const npp = createNpp({ actionPoints: 20, funds: 1_000_000, donorBaseLevel: 0 });
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      mockNppFind.mockReturnValue(createAsyncCursor([npp]));

      const result = await processNppActions(mockDb, 4);

      expect(result.buildDonorBase).toBe(2);
      expect(mockBulkWrite).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            updateOne: expect.objectContaining({
              update: expect.objectContaining({
                $inc: expect.objectContaining({ actionPoints: -15, funds: -35_000 }),
                $set: expect.objectContaining({ donorBaseLevel: 2 }),
              }),
            }),
          }),
        ])
      );
    });

    it("stops the cycle when a none decision is returned", async () => {
      vi.mocked(decideNppAction)
        .mockReturnValueOnce({ action: "campaign", reason: "t" })
        .mockReturnValueOnce({ action: "none", reason: "saving" });

      const npp = createNpp({ actionPoints: 50, funds: 1_000_000 });
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      mockNppFind.mockReturnValue(createAsyncCursor([npp]));

      const result = await processNppActions(mockDb, 4);

      expect(result.actionsExecuted).toBe(1);
      expect(result.campaign).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it("accumulates multiple partyDonations from one NPP into the party treasury", async () => {
      vi.mocked(decideNppAction).mockReturnValue({ action: "partyDonation", reason: "t" });

      const partyId = new ObjectId();
      const npp = createNpp({ party: "1", actionPoints: 100, funds: 1_000_000 });
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      mockNppFind.mockReturnValue(createAsyncCursor([npp]));
      mockPartyFind.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ sequentialId: 1, countryId: "US", _id: partyId }]),
      });

      const result = await processNppActions(mockDb, 4);

      expect(result.partyDonation).toBe(NPP_ACTIONS_PER_CYCLE);
      // One NPP-update bulkWrite + one party-treasury bulkWrite.
      expect(mockBulkWrite).toHaveBeenCalledTimes(2);
      // Party treasury credited 4 * 5_000 (USD homeRate 1).
      expect(mockBulkWrite).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            updateOne: expect.objectContaining({
              filter: { _id: partyId },
              update: { $inc: { treasury: 20_000 } },
            }),
          }),
        ])
      );
    });

    it("emits exactly one NPP update per acting NPP regardless of action count", async () => {
      vi.mocked(decideNppAction).mockReturnValue({ action: "advertise", reason: "t" });

      const npp = createNpp({ actionPoints: 100, funds: 1_000_000 });
      mockFindOne.mockResolvedValue({ nppEconomyEnabled: true });
      mockNppFind.mockReturnValue(createAsyncCursor([npp]));

      await processNppActions(mockDb, 4);

      // npps.bulkWrite called once; its op array holds a single updateOne for the NPP.
      expect(mockBulkWrite).toHaveBeenCalledTimes(1);
      const ops = mockBulkWrite.mock.calls[0][0];
      expect(ops).toHaveLength(1);
    });
  });
});

// ── v3/v4 autonomy country scope (t834) ──────────────────────────────────────
import { nonPlayerCountryIds } from "./nppActionProcessing";

describe("nonPlayerCountryIds (v3 autonomy scope)", () => {
  const access = {
    US: { enabledForPlayers: true },
    BR: { enabledForPlayers: false },
    FR: { enabledForPlayers: false },
    UK: { enabledForPlayers: true },
  };
  it("returns only non-player-enabled countries", () => {
    expect(nonPlayerCountryIds(access).sort()).toEqual(["BR", "FR"]);
  });
  it("excludes every country when all are player-enabled", () => {
    expect(nonPlayerCountryIds({ US: { enabledForPlayers: true } })).toEqual([]);
  });
  it("returns all when none are player-enabled", () => {
    expect(nonPlayerCountryIds({ BR: { enabledForPlayers: false } })).toEqual(["BR"]);
  });
});
