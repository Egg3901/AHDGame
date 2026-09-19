import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { executeAgreedAcquisition } from "./executeAgreedAcquisition";

vi.mock("@/lib/nationalization/ownershipTransition", () => ({ payShareholders: vi.fn() }));
vi.mock("@/lib/corporations/moveSector", () => ({ moveSectorToCorp: vi.fn() }));
vi.mock("@/lib/financialTxLog/atomicCashGuard", () => ({
  atomicallyDebitCorpLiquidCapital: vi.fn().mockResolvedValue({ ok: true, newBalance: 0 }),
  creditCorpLiquidCapital: vi.fn().mockResolvedValue(0),
  refundCorpLiquidCapital: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/currency/corporationCapital", () => ({
  anchorToCorpLiquidCapital: (a: number) => a,
  corpLiquidCapitalToAnchor: (a: number) => a,
  getCorpFxRate: vi.fn().mockResolvedValue(1),
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map()),
  resolveCorpLiquidCurrencyCode: () => "USD",
}));
vi.mock("@/lib/corporations/cleanupShareMarketActivity", () => ({
  cleanupShareMarketActivityForCorporations: vi.fn(),
}));
vi.mock("@/lib/financialTxLog/stampDeleted", () => ({ stampSubjectDeleted: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/corporations/mergerReview/gate", () => ({
  assertMergerClearance: vi.fn().mockResolvedValue({ ok: true }),
  acquisitionsBarredByDivestiture: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/corporations/mergerReview/lifecycle", () => ({
  attachMergerRemedy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/banking/transferCharter", () => ({
  bankTransferConflict: vi.fn().mockReturnValue(null),
  transferBankCharterToAcquirer: vi.fn(),
}));

import { emitTx } from "@/lib/financialTxLog/emit";
import { payShareholders } from "@/lib/nationalization/ownershipTransition";
import { moveSectorToCorp } from "@/lib/corporations/moveSector";
import {
  atomicallyDebitCorpLiquidCapital,
  creditCorpLiquidCapital,
  refundCorpLiquidCapital,
} from "@/lib/financialTxLog/atomicCashGuard";
import { transferBankCharterToAcquirer } from "@/lib/banking/transferCharter";

const ACQ = new ObjectId();
const TGT = new ObjectId();
const PRICE = 1_000_000;
const TARGET_CASH = 5_000_000;

const CHARTER_OK = {
  ok: true as const,
  transferred: false,
  currency: null,
  loansRekeyed: 0,
  interbankSidesRekeyed: 0,
  savingsAccountsRekeyed: 0,
  depositorPointersRekeyed: 0,
};
const CHARTER_RACE = {
  ok: false as const,
  error: "Cannot merge TargetCo: AcquireCo gained a bank charter during the merge. Try again.",
};

function makeOffer(priceAnchor = PRICE) {
  return {
    _id: new ObjectId(),
    acquirerCorporationId: ACQ,
    targetCorporationId: TGT,
    proposedByCharacterId: new ObjectId(),
    priceAnchor,
    targetValuationAnchor: priceAnchor,
    status: "pending" as const,
    createdAtTurn: 100,
    expiresAtTurn: 124,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeDb({
  sectors = [] as unknown[],
  targetCash = TARGET_CASH,
}: { sectors?: unknown[]; targetCash?: number } = {}) {
  const acquirer = {
    _id: ACQ,
    name: "AcquireCo",
    liquidCapital: 1_000_000_000,
    liquidCurrencyCode: "USD",
  };
  const target = {
    _id: TGT,
    name: "TargetCo",
    liquidCapital: targetCash,
    liquidCurrencyCode: "USD",
    sequentialId: 42,
    totalShares: 1_000,
    shareholders: [{ characterId: new ObjectId(), shares: 1_000 }],
  };
  const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
  const corpUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1, matchedCount: 1 });
  const db = {
    collection: vi.fn((name: string) => {
      if (name === "corporations")
        return {
          findOne: ({ _id }: { _id: ObjectId }) => {
            if (_id.equals(ACQ)) return Promise.resolve(acquirer);
            if (_id.equals(TGT)) return Promise.resolve(target);
            return Promise.resolve(null);
          },
          countDocuments: vi.fn().mockResolvedValue(0),
          updateOne: corpUpdateOne,
          deleteOne,
        };
      if (name === "bonds") return { countDocuments: vi.fn().mockResolvedValue(0) };
      if (name === "corporateSectors")
        return { find: vi.fn().mockReturnValue({ toArray: () => Promise.resolve(sectors) }) };
      return {};
    }),
  } as unknown as Db;
  return { db, deleteOne, corpUpdateOne };
}

describe("executeAgreedAcquisition charter-race compensation (issue #2005)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(transferBankCharterToAcquirer).mockResolvedValue(CHARTER_OK);
  });

  it("refunds the acquirer debit when the charter transfer loses its race", async () => {
    // Pre-check sees a charter-free acquirer, but the transfer re-reads and
    // finds it chartered a bank in between. The debit already applied, so the
    // merge must unwind: same 500 as before, money conserved, and nothing
    // downstream (payout, cash fold, sectors, ledger, teardown) may run.
    vi.mocked(transferBankCharterToAcquirer).mockResolvedValueOnce(CHARTER_RACE);
    const { db, deleteOne } = makeDb({ sectors: [{ _id: new ObjectId() }] });

    const r = await executeAgreedAcquisition({ db, offer: makeOffer() as never, currentTurn: 200 });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/gained a bank charter during the merge/);
      expect(r.status).toBe(500);
    }
    // Money conservation: the debit is followed by exactly one matching refund.
    expect(vi.mocked(atomicallyDebitCorpLiquidCapital)).toHaveBeenCalledWith(db, ACQ, PRICE);
    expect(vi.mocked(refundCorpLiquidCapital)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(refundCorpLiquidCapital)).toHaveBeenCalledWith(db, ACQ, PRICE);
    // No partial ownership/charter state: no payout, no cash fold, no sector
    // moves, no ledger legs, and the shell is not deleted.
    expect(vi.mocked(payShareholders)).not.toHaveBeenCalled();
    expect(vi.mocked(creditCorpLiquidCapital)).not.toHaveBeenCalled();
    expect(vi.mocked(moveSectorToCorp)).not.toHaveBeenCalled();
    expect(vi.mocked(emitTx)).not.toHaveBeenCalled();
    expect(deleteOne).not.toHaveBeenCalled();
  });

  it("runs the charter transfer before any payout so the race cannot strand money", async () => {
    const { db } = makeDb({ sectors: [{ _id: new ObjectId() }] });
    const r = await executeAgreedAcquisition({ db, offer: makeOffer() as never, currentTurn: 200 });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bankCharterTransferred).toBe(false);
    const order = (fn: ReturnType<typeof vi.fn>) => fn.mock.invocationCallOrder[0];
    expect(order(vi.mocked(transferBankCharterToAcquirer))).toBeLessThan(
      order(vi.mocked(payShareholders))
    );
    expect(order(vi.mocked(payShareholders))).toBeLessThan(order(vi.mocked(moveSectorToCorp)));
  });

  it("refunds exactly once when the shareholder payout throws", async () => {
    vi.mocked(payShareholders).mockRejectedValueOnce(new Error("payout boom"));
    const { db, deleteOne } = makeDb({ sectors: [{ _id: new ObjectId() }] });

    await expect(
      executeAgreedAcquisition({ db, offer: makeOffer() as never, currentTurn: 200 })
    ).rejects.toThrow("payout boom");
    expect(vi.mocked(refundCorpLiquidCapital)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(refundCorpLiquidCapital)).toHaveBeenCalledWith(db, ACQ, PRICE);
    expect(vi.mocked(moveSectorToCorp)).not.toHaveBeenCalled();
    expect(deleteOne).not.toHaveBeenCalled();
  });

  it("claws back the shell-cash credit when a sector move throws", async () => {
    vi.mocked(moveSectorToCorp).mockRejectedValueOnce(new Error("sector boom"));
    const { db, deleteOne, corpUpdateOne } = makeDb({ sectors: [{ _id: new ObjectId() }] });

    await expect(
      executeAgreedAcquisition({ db, offer: makeOffer() as never, currentTurn: 200 })
    ).rejects.toThrow("sector boom");
    // Full debit refund plus exactly one clawback of the landed cash credit.
    expect(vi.mocked(refundCorpLiquidCapital)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(refundCorpLiquidCapital)).toHaveBeenCalledWith(db, ACQ, PRICE);
    const clawback = corpUpdateOne.mock.calls.find(
      ([, update]) =>
        (update as { $inc?: { liquidCapital?: number } }).$inc?.liquidCapital === -TARGET_CASH
    );
    expect(clawback).toBeDefined();
    expect(vi.mocked(emitTx)).not.toHaveBeenCalled();
    expect(deleteOne).not.toHaveBeenCalled();
  });

  it("reports rollback failure instead of silent success when the refund write fails", async () => {
    vi.mocked(payShareholders).mockRejectedValueOnce(new Error("payout boom"));
    vi.mocked(refundCorpLiquidCapital).mockRejectedValueOnce(new Error("db down"));
    const { db } = makeDb();

    await expect(
      executeAgreedAcquisition({ db, offer: makeOffer() as never, currentTurn: 200 })
    ).rejects.toThrow(/rollback failed/);
  });

  it("owes no refund on a charter race when the price is zero", async () => {
    vi.mocked(transferBankCharterToAcquirer).mockResolvedValueOnce(CHARTER_RACE);
    const { db } = makeDb();

    const r = await executeAgreedAcquisition({
      db,
      offer: makeOffer(0) as never,
      currentTurn: 200,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(500);
    expect(vi.mocked(atomicallyDebitCorpLiquidCapital)).not.toHaveBeenCalled();
    expect(vi.mocked(refundCorpLiquidCapital)).not.toHaveBeenCalled();
    expect(vi.mocked(payShareholders)).not.toHaveBeenCalled();
  });
});
