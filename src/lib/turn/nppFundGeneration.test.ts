import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, createAsyncIterableCursor, type MockDb } from "@/lib/test-utils/mockDb";
import type { State } from "@/lib/db/types";

vi.mock("@/lib/utils/fundGeneration", () => ({
  projectNppGeneration: vi.fn(),
  calculateTaxAmount: vi.fn().mockReturnValue(0),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  loadTxThresholds: vi.fn().mockResolvedValue({}),
  emitTxBulk: vi.fn(),
}));
vi.mock("@/lib/treasury/emit", () => ({
  emitTreasuryTransactionsBulk: vi.fn(),
}));

import { projectNppGeneration } from "@/lib/utils/fundGeneration";
import { processNppFundGeneration } from "./nppFundGeneration";

describe("processNppFundGeneration", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    vi.clearAllMocks();
  });

  /** Wire the collections processNppFundGeneration reads, with one npp in the cursor. */
  function setup(npp: Record<string, unknown>) {
    db.collection("gameConfig");
    db.collectionMocks.gameConfig!.findOne = vi
      .fn()
      .mockResolvedValue({ _id: "default", nppEconomyEnabled: true });

    for (const name of ["politicalParties", "statePartyOrg"]) {
      db.collection(name);
      db.collectionMocks[name]!.find = vi
        .fn()
        .mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    }

    db.collection("characters");
    db.collectionMocks.characters!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    });

    db.collection("npps");
    db.collectionMocks.npps!.find = vi.fn().mockReturnValue(createAsyncIterableCursor([npp]));
  }

  const stateMap = (id: string, countryId: string): Map<string, State> =>
    new Map([[id, { _id: id, name: id, countryId, population: 17_000_000 } as State]]);

  it("credits an independent US NPP its anchor generation at ×1.0 (unchanged)", async () => {
    vi.mocked(projectNppGeneration).mockReturnValue(20_000);
    const npp = {
      _id: new ObjectId(),
      countryId: "US",
      party: "independent",
      homeState: "US-CA",
      funds: 40_000,
      donorBaseLevel: 0,
      actionPoints: 0,
    };
    setup(npp);

    await processNppFundGeneration(db as unknown as Db, 100, stateMap("US-CA", "US"));

    const op = (db.collectionMocks.npps!.bulkWrite.mock.calls[0]?.[0] as
      { updateOne: { update: { $inc: { funds: number } } } }[] | undefined)![0]!.updateOne;
    expect(op.update.$inc.funds).toBe(20_000);
  });

  it("scales an independent NG NPP to local (×1550) and feeds the curve anchor-equivalent funds", async () => {
    vi.mocked(projectNppGeneration).mockReturnValue(20_000); // anchor gross
    const npp = {
      _id: new ObjectId(),
      countryId: "NG",
      party: "independent",
      homeState: "NG-SW",
      funds: 62_000_000, // local naira balance == 40,000 anchor at rate 1550
      donorBaseLevel: 0,
      actionPoints: 0,
    };
    setup(npp);

    await processNppFundGeneration(db as unknown as Db, 100, stateMap("NG-SW", "NG"));

    // Credit is the anchor gross denominated to local at the frozen NG rate.
    const op = (db.collectionMocks.npps!.bulkWrite.mock.calls[0]?.[0] as
      { updateOne: { update: { $inc: { funds: number } } } }[] | undefined)![0]!.updateOne;
    expect(op.update.$inc.funds).toBe(Math.round(20_000 * 1550));

    // Diminishing-returns curve must see the ANCHOR-equivalent balance
    // (62,000,000 / 1550 = 40,000), so the soft cap triggers at the same
    // economic scale in every country.
    expect(vi.mocked(projectNppGeneration)).toHaveBeenCalledWith(
      expect.objectContaining({ currentFundsLocal: 62_000_000 / 1550 })
    );
  });
});
