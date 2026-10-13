/**
 * A vacant seat's contribution goes to the Treasury. With the Treasury cash
 * ledger enabled that must be one paired settlement, never a corporation debit
 * followed by a plain Treasury credit (which the ledger refuses after the
 * corporation has already paid).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const settleTransition = vi.fn();
const loadTreasuryCashContext = vi.fn();
const atomicallyDebitCorpLiquidCapital = vi.fn();
const creditTreasuryProceedsFromAnchor = vi.fn();
const refundCorpLiquidCapital = vi.fn();

vi.mock("@/lib/banking/settlementJournal", () => ({ settleTransition }));
vi.mock("@/lib/nationalization/treasuryLedger", () => ({ loadTreasuryCashContext }));
vi.mock("@/lib/nationalization/treasury", () => ({ creditTreasuryProceedsFromAnchor }));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn() }));
vi.mock("@/lib/financialTxLog/atomicCashGuard", () => ({
  atomicallyDebitCorpLiquidCapital,
  refundCorpLiquidCapital,
  refundCharacterCash: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: async () => true }));
vi.mock("@/lib/currency/corporationCapital", () => ({
  getCorpFxRate: async () => 1,
  anchorToCorpLiquidCapital: (a: number) => a,
}));
vi.mock("@/lib/corporations/mergerReview/authority", () => ({
  resolveMergerAuthority: async () => ({ seatId: "seat", seatName: "Index Committee" }),
}));

const { fileListingPetition } = await import("./service");

function fakeDb() {
  const petitions: Record<string, unknown>[] = [];
  const collection = () => ({
    findOne: async () => null,
    insertOne: async (doc: Record<string, unknown>) => {
      petitions.push(doc);
      return { insertedId: doc._id };
    },
    deleteOne: async (filter: { _id: ObjectId }) => {
      const i = petitions.findIndex((p) => p._id === filter._id);
      if (i >= 0) petitions.splice(i, 1);
      return { deletedCount: i >= 0 ? 1 : 0 };
    },
  });
  return { db: { collection } as never, petitions };
}

const corporation = {
  _id: new ObjectId(),
  name: "Acme",
  countryId: "US",
  liquidCurrencyCode: "USD",
  liquidCapital: 5_000,
  isPrivate: false,
} as never;

const enabledContext = {
  treasuryCashLedgerEnabled: true,
  treasuryCurrencies: new Map([["US", "USD"]]),
  rates: new Map([["USD", 1]]),
  preset: undefined,
};

describe("listing petition contribution to a vacant seat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    atomicallyDebitCorpLiquidCapital.mockResolvedValue({ ok: true });
  });

  it("pays the Treasury through one paired settlement when the cash ledger is on", async () => {
    loadTreasuryCashContext.mockResolvedValue(enabledContext);
    settleTransition.mockResolvedValue({ status: "applied" });
    const { db, petitions } = fakeDb();

    const result = await fileListingPetition({
      db,
      corporation,
      filedByCharacterId: new ObjectId(),
      contributionAnchor: 1_000,
      currentTurn: 150,
      currentYear: null,
    });

    expect(result.ok).toBe(true);
    expect(atomicallyDebitCorpLiquidCapital).not.toHaveBeenCalled();
    expect(creditTreasuryProceedsFromAnchor).not.toHaveBeenCalled();
    expect(settleTransition).toHaveBeenCalledTimes(1);
    const transition = settleTransition.mock.calls[0][1];
    expect(transition.key).toBe(`index-listing-petition:${String(petitions[0]._id)}`);
    expect(transition.legs.map((l: { kind: string; path: string }) => [l.kind, l.path])).toEqual([
      ["debit", "liquidCapital"],
      ["credit", "treasuryCashLocal"],
    ]);
    expect(transition.legs[0].amount).toBe(1_000);
    expect(transition.legs[1].amount).toBe(1_000);
    expect(petitions).toHaveLength(1);
  });

  it("drops the petition and charges nothing when the settlement refuses", async () => {
    loadTreasuryCashContext.mockResolvedValue(enabledContext);
    settleTransition.mockResolvedValue({ status: "rejected", error: "guard failed" });
    const { db, petitions } = fakeDb();

    const result = await fileListingPetition({
      db,
      corporation,
      filedByCharacterId: new ObjectId(),
      contributionAnchor: 9_000,
      currentTurn: 150,
      currentYear: null,
    });

    expect(result.ok).toBe(false);
    expect(atomicallyDebitCorpLiquidCapital).not.toHaveBeenCalled();
    expect(refundCorpLiquidCapital).not.toHaveBeenCalled();
    expect(petitions).toHaveLength(0);
  });

  it("keeps the legacy debit and credit when the cash ledger is off", async () => {
    loadTreasuryCashContext.mockResolvedValue(null);
    creditTreasuryProceedsFromAnchor.mockResolvedValue(1_000);
    const { db } = fakeDb();

    const result = await fileListingPetition({
      db,
      corporation,
      filedByCharacterId: new ObjectId(),
      contributionAnchor: 1_000,
      currentTurn: 150,
      currentYear: null,
    });

    expect(result.ok).toBe(true);
    expect(atomicallyDebitCorpLiquidCapital).toHaveBeenCalledTimes(1);
    expect(creditTreasuryProceedsFromAnchor).toHaveBeenCalledTimes(1);
    expect(settleTransition).not.toHaveBeenCalled();
  });
});
