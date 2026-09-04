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
// Merger review is exercised in its own suite; here it must not interfere.
vi.mock("@/lib/corporations/mergerReview/gate", () => ({
  assertMergerClearance: vi.fn().mockResolvedValue({ ok: true }),
  acquisitionsBarredByDivestiture: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/corporations/mergerReview/lifecycle", () => ({
  attachMergerRemedy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn().mockResolvedValue(undefined) }));

import { emitTx } from "@/lib/financialTxLog/emit";
import { payShareholders } from "@/lib/nationalization/ownershipTransition";
import { moveSectorToCorp } from "@/lib/corporations/moveSector";
import { atomicallyDebitCorpLiquidCapital } from "@/lib/financialTxLog/atomicCashGuard";

const ACQ = new ObjectId();
const TGT = new ObjectId();

function makeOffer(priceAnchor = 1_000_000) {
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

function makeCharter(charteredTurn: number) {
  return {
    type: "retail",
    status: "active",
    currency: "USD",
    charteredTurn,
    postedCapital: 50_000_000,
    depositOffset: 0,
    lendingOffset: 0,
    cashReserves: 123_410_000,
    npcDeposits: 71_110_000,
  };
}

function makeDb({
  bonds = 0,
  crossHoldings = 0,
  sectors = [] as unknown[],
  targetCash = 5_000_000,
  targetCharter,
  acquirerCharter,
}: {
  bonds?: number;
  crossHoldings?: number;
  sectors?: unknown[];
  targetCash?: number;
  targetCharter?: Record<string, unknown>;
  acquirerCharter?: Record<string, unknown>;
}) {
  const acquirer = {
    _id: ACQ,
    name: "AcquireCo",
    liquidCapital: 1_000_000_000,
    liquidCurrencyCode: "USD",
    ...(acquirerCharter ? { bankCharter: acquirerCharter } : {}),
  };
  const target = {
    _id: TGT,
    name: "TargetCo",
    liquidCapital: targetCash,
    liquidCurrencyCode: "USD",
    sequentialId: 42,
    totalShares: 1_000,
    shareholders: [{ characterId: new ObjectId(), shares: 1_000 }],
    ...(targetCharter ? { bankCharter: targetCharter } : {}),
  };
  const deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
  const corpFindOne = vi.fn(({ _id }: { _id: ObjectId }) => {
    if (_id.equals(ACQ)) return Promise.resolve(acquirer);
    if (_id.equals(TGT)) return Promise.resolve(target);
    return Promise.resolve(null);
  });
  const corpUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1, matchedCount: 1 });
  const bankUpdateMany = vi.fn().mockResolvedValue({ modifiedCount: 0 });
  const db = {
    collection: vi.fn((name: string) => {
      if (name === "corporations")
        return {
          findOne: corpFindOne,
          countDocuments: vi.fn().mockResolvedValue(crossHoldings),
          updateOne: corpUpdateOne,
          deleteOne,
        };
      if (name === "bonds") return { countDocuments: vi.fn().mockResolvedValue(bonds) };
      if (name === "corporateSectors")
        return { find: vi.fn().mockReturnValue({ toArray: () => Promise.resolve(sectors) }) };
      if (
        name === "bankLoans" ||
        name === "interbankLoans" ||
        name === "savingsAccounts" ||
        name === "characters"
      )
        return { updateMany: bankUpdateMany };
      return {};
    }),
  } as unknown as Db;
  return { db, deleteOne, corpUpdateOne, bankUpdateMany };
}

describe("executeAgreedAcquisition", () => {
  beforeEach(() => vi.clearAllMocks());

  it("blocks acquiring a target with outstanding bonds", async () => {
    const { db, deleteOne } = makeDb({ bonds: 2 });
    const r = await executeAgreedAcquisition({ db, offer: makeOffer() as never, currentTurn: 200 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/outstanding bonds/i);
    expect(deleteOne).not.toHaveBeenCalled();
    expect(vi.mocked(atomicallyDebitCorpLiquidCapital)).not.toHaveBeenCalled();
  });

  it("blocks acquiring a target that holds equity in other corporations", async () => {
    const { db } = makeDb({ crossHoldings: 1 });
    const r = await executeAgreedAcquisition({ db, offer: makeOffer() as never, currentTurn: 200 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/equity in other corporations/i);
  });

  it("blocks when the acquirer cannot afford the price (no assets moved)", async () => {
    vi.mocked(atomicallyDebitCorpLiquidCapital).mockResolvedValueOnce({
      ok: false,
      error: "Insufficient corporate funds",
    });
    const { db, deleteOne } = makeDb({ sectors: [{ _id: new ObjectId() }] });
    const r = await executeAgreedAcquisition({ db, offer: makeOffer() as never, currentTurn: 200 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/insufficient corporate funds/i);
    expect(vi.mocked(payShareholders)).not.toHaveBeenCalled();
    expect(vi.mocked(moveSectorToCorp)).not.toHaveBeenCalled();
    expect(deleteOne).not.toHaveBeenCalled();
  });

  it("happy path: debits acquirer, pays shareholders, moves sectors, deletes the target shell", async () => {
    const sectors = [{ _id: new ObjectId() }, { _id: new ObjectId() }];
    const { db, deleteOne } = makeDb({ sectors });
    const offer = makeOffer(1_000_000);
    const r = await executeAgreedAcquisition({ db, offer: offer as never, currentTurn: 200 });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sectorsMoved).toBe(2);
    // Acquirer paid the agreed price.
    expect(vi.mocked(atomicallyDebitCorpLiquidCapital)).toHaveBeenCalledWith(db, ACQ, 1_000_000);
    // Shareholders paid the pool (fund-correct payShareholders), for the target.
    const payCall = vi.mocked(payShareholders).mock.calls[0];
    expect(payCall[2]).toBe(1_000_000); // poolAnchor
    // Each sector re-parented, and the shell deleted.
    expect(vi.mocked(moveSectorToCorp)).toHaveBeenCalledTimes(2);
    expect(deleteOne).toHaveBeenCalledWith({ _id: TGT });
  });

  it("ledgers the acquirer outflow and both shell-cash legs", async () => {
    const { db } = makeDb({ sectors: [{ _id: new ObjectId() }], targetCash: 5_000_000 });
    const r = await executeAgreedAcquisition({
      db,
      offer: makeOffer(1_000_000) as never,
      currentTurn: 200,
    });
    expect(r.ok).toBe(true);

    const legs = vi.mocked(emitTx).mock.calls.map((c) => c[1]);
    const outflow = legs.find((l) => l.type === "share_buyout_outflow");
    expect(outflow).toBeDefined();
    expect(outflow?.amount).toBe(-1_000_000);
    expect(outflow?.subjectId).toBe(ACQ);

    // The shell's cash is not created or destroyed: it leaves the target and
    // lands on the acquirer, so the two legs must net to zero.
    const shellLegs = legs.filter((l) => l.type === "corp_dissolution_distribution");
    expect(shellLegs).toHaveLength(2);
    expect(shellLegs.reduce((sum, l) => sum + l.amount, 0)).toBe(0);
  });

  it("passes ledger context to payShareholders so holder credits are logged", async () => {
    const { db } = makeDb({ sectors: [] });
    await executeAgreedAcquisition({ db, offer: makeOffer(1_000_000) as never, currentTurn: 200 });
    const payCall = vi.mocked(payShareholders).mock.calls[0];
    expect(payCall[5]).toEqual({ turn: 200, kind: "agreed_acquisition" });
  });

  it("moves the target bank to the acquirer instead of deleting it (ticket-1267)", async () => {
    const { db, deleteOne, corpUpdateOne, bankUpdateMany } = makeDb({
      sectors: [],
      targetCharter: makeCharter(150),
    });
    const r = await executeAgreedAcquisition({
      db,
      offer: makeOffer(1_000_000) as never,
      currentTurn: 200,
    });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bankCharterTransferred).toBe(true);
    expect(deleteOne).toHaveBeenCalledWith({ _id: TGT });
    const claimCall = corpUpdateOne.mock.calls.find(
      ([filter]) =>
        (filter as Record<string, unknown>)._id === ACQ &&
        "bankCharter" in (filter as Record<string, unknown>)
    );
    expect(claimCall).toBeDefined();
    expect((claimCall?.[1] as { $set: Record<string, unknown> }).$set.bankCharter).toMatchObject({
      charteredTurn: 150,
    });
    expect(bankUpdateMany).toHaveBeenCalled();
  });

  it("blocks acquiring a banked target when the acquirer already operates a bank", async () => {
    const { db, deleteOne } = makeDb({
      targetCharter: makeCharter(150),
      acquirerCharter: makeCharter(100),
    });
    const r = await executeAgreedAcquisition({
      db,
      offer: makeOffer(1_000_000) as never,
      currentTurn: 200,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/already operates a bank/);
      expect(r.status).toBe(400);
    }
    expect(vi.mocked(atomicallyDebitCorpLiquidCapital)).not.toHaveBeenCalled();
    expect(deleteOne).not.toHaveBeenCalled();
  });
});
