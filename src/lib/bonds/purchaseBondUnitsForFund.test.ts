import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Bond, IndexFund } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { purchaseBondUnitsForFund } from "./purchaseBondUnitsForFund";

vi.mock("@/lib/currency/corporationCapital", () => ({
  corpCapitalToAnchor: vi.fn((amount: number) => amount),
  loadFxRatesRecord: vi.fn().mockResolvedValue({ USD: 1 }),
}));
vi.mock("@/lib/bonds/marketPool", () => ({
  loadBondQuote: vi.fn().mockResolvedValue({ askPerUnit: 1_000, bidPerUnit: 990 }),
  creditBondPool: vi.fn().mockResolvedValue(undefined),
  advanceBondPoolSnapshot: vi.fn(),
}));
vi.mock("@/lib/bonds/bondHolderOps", () => ({
  reserveBondUnitsForHolder: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/indexFunds/fundQueries", () => ({
  insertFundTransaction: vi.fn().mockResolvedValue(new ObjectId()),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));

import { reserveBondUnitsForHolder } from "@/lib/bonds/bondHolderOps";
import { insertFundTransaction } from "@/lib/indexFunds/fundQueries";
import { emitTx } from "@/lib/financialTxLog/emit";

describe("purchaseBondUnitsForFund", () => {
  it("enforces the sovereign per-issue cap before debiting fund cash", async () => {
    const fundId = new ObjectId();
    const bond = {
      _id: new ObjectId(),
      issuerType: "sovereign",
      faceValue: 1_000,
      totalIssued: 1_000_000,
      publicFloat: 1_000,
      holders: [{ fundId, units: 200 }],
      matured: false,
      defaulted: false,
    } as unknown as Bond;
    const fund = {
      _id: fundId,
      name: "Test Fund",
      quotedNav: 100,
      anchorCurrencyCode: "USD",
    } as IndexFund;
    const collection = vi.fn();

    await expect(
      purchaseBondUnitsForFund({ collection } as unknown as Db, fund, bond, 51)
    ).resolves.toEqual({ ok: false, reason: "position_limit" });
    expect(collection).not.toHaveBeenCalled();
  });

  describe("fund-subject ledger leg (#992 tranche 6)", () => {
    let db: MockDb;
    const fundId = new ObjectId();
    const fund = {
      _id: fundId,
      name: "Test Fund",
      quotedNav: 100,
      anchorCurrencyCode: "USD",
    } as IndexFund;
    const bond = {
      _id: new ObjectId(),
      issuerType: "sovereign",
      issuerName: "US Treasury",
      currencyCode: "USD",
      marketPrice: 1,
      publicFloat: 1_000,
      holders: [],
      matured: false,
      defaulted: false,
    } as unknown as Bond;

    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(reserveBondUnitsForHolder).mockResolvedValue(true);
      db = createMockDb();
      db.collection("indexFunds");
      db.collectionMocks.indexFunds.findOneAndUpdate.mockResolvedValue({ cashAnchor: 5_000 });
      db.collectionMocks.indexFunds.updateOne.mockResolvedValue({ matchedCount: 1 });
    });

    it("emits one fund-subject bond_purchase row debiting the exact cost when a turn is passed", async () => {
      const result = await purchaseBondUnitsForFund(db as unknown as Db, fund, bond, 5, {
        turn: 7,
        thresholds: { fund: {} },
      } as never);

      expect(result).toMatchObject({ ok: true, units: 5, costAnchor: 5_000 });
      expect(insertFundTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ kind: "bond_allocation", amountAnchor: 5_000 })
      );
      expect(emitTx).toHaveBeenCalledTimes(1);
      expect(emitTx).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: "bond_purchase",
          turn: 7,
          subjectType: "fund",
          subjectId: fundId,
          amount: -5_000,
          anchorAmount: -5_000,
          currencyCode: "USD",
          counterpartyType: "system",
          counterpartyName: "US Treasury",
        }),
        { fund: {} }
      );
    });

    it("emits no ledger row when no turn is passed", async () => {
      const result = await purchaseBondUnitsForFund(db as unknown as Db, fund, bond, 5);

      expect(result).toMatchObject({ ok: true, units: 5 });
      expect(emitTx).not.toHaveBeenCalled();
    });

    it("emits no ledger row when the reservation fails and cash is refunded", async () => {
      vi.mocked(reserveBondUnitsForHolder).mockResolvedValue(false);

      const result = await purchaseBondUnitsForFund(db as unknown as Db, fund, bond, 5, {
        turn: 7,
      });

      expect(result).toEqual({ ok: false, reason: "reservation_failed" });
      expect(db.collectionMocks.indexFunds.updateOne).toHaveBeenCalledWith(
        { _id: fundId },
        expect.objectContaining({ $inc: { cashAnchor: 5_000 } })
      );
      expect(emitTx).not.toHaveBeenCalled();
    });
  });
});
