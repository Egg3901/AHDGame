/**
 * Agreed-acquisition execution against the durable settlement seams.
 *
 * State-based (in-memory collections), not call-based: every preserved
 * assertion from the old suite now reads the money, the shell, and the
 * settlement record instead of the mocks the old flow used to call.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { AcquisitionSettlement } from "@/lib/db/types/acquisitionSettlement";
import { buildAcquisitionWorld, readBalances, ACQUIRER_CASH } from "./acquisitionSettlementWorld";

vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/currency/corporationCapital", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/currency/corporationCapital")>();
  return {
    ...mod,
    loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map()),
    getCorpFxRate: vi.fn().mockResolvedValue(1),
  };
});
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));
// Merger review is exercised in its own suite; here it must not interfere.
vi.mock("@/lib/corporations/mergerReview/gate", () => ({
  assertMergerClearance: vi.fn().mockResolvedValue({ ok: true }),
  acquisitionsBarredByDivestiture: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/corporations/mergerReview/lifecycle", () => ({
  attachMergerRemedy: vi.fn().mockResolvedValue(undefined),
}));

import { executeAgreedAcquisition } from "./executeAgreedAcquisition";
import { emitTx } from "@/lib/financialTxLog/emit";

describe("executeAgreedAcquisition", () => {
  beforeEach(() => vi.clearAllMocks());

  it("blocks acquiring a target with outstanding bonds", async () => {
    const w = buildAcquisitionWorld();
    w.memory.seed("bonds", [{ _id: new ObjectId(), corporationId: w.tgt, matured: false }]);
    const r = await executeAgreedAcquisition({
      db: w.db,
      offer: w.offer as never,
      currentTurn: 200,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/outstanding bonds/i);
    const balances = await readBalances(w);
    expect(balances.targetGone).toBe(false);
    expect(balances.acquirer).toBe(ACQUIRER_CASH);
    expect(
      await w.memory.collection("acquisitionSettlements").countDocuments({ _id: w.offerId })
    ).toBe(0);
  });

  it("blocks acquiring a target that holds equity in other corporations", async () => {
    const w = buildAcquisitionWorld();
    w.memory.seed("corporations", [
      {
        _id: new ObjectId(),
        name: "ElsewhereCo",
        liquidCapital: 0,
        countryId: "US",
        shareholders: [{ corporationId: w.tgt, shares: 10 }],
      },
    ]);
    const r = await executeAgreedAcquisition({
      db: w.db,
      offer: w.offer as never,
      currentTurn: 200,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/equity in other corporations/i);
  });

  it("blocks when the acquirer cannot afford the price (no assets moved)", async () => {
    const w = buildAcquisitionWorld({ acquirerCash: 100 });
    const r = await executeAgreedAcquisition({
      db: w.db,
      offer: w.offer as never,
      currentTurn: 200,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/insufficient corporate funds/i);
    const balances = await readBalances(w);
    expect(balances.acquirer).toBe(100);
    expect(balances.charA).toBe(0);
    expect(balances.targetGone).toBe(false);
    expect(balances.acquirerSectors).toBe(0);
  });

  it("happy path: debits acquirer, pays every holder bucket, moves sectors, deletes the target shell", async () => {
    const w = buildAcquisitionWorld({ sectorCount: 2 });
    const r = await executeAgreedAcquisition({
      db: w.db,
      offer: w.offer as never,
      currentTurn: 200,
    });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sectorsMoved).toBe(2);
    const b = await readBalances(w);
    // Acquirer paid exactly the agreed price, then absorbed the shell cash.
    expect(b.acquirer).toBe(ACQUIRER_CASH - 1_000_000 + 5_000_000);
    // Every holder bucket paid its pinned slice exactly once.
    expect(b.charA).toBe(300_000);
    expect(b.charB).toBe(200_000);
    expect(b.imperial).toBe(100_000);
    expect(b.corpHolder).toBe(1_000 + 200_000);
    expect(b.fundCash).toBe(100_000);
    expect(b.fundHoldings).toBe(0);
    expect(b.treasury).toBe(100_000);
    // Each sector re-parented, and the shell deleted.
    expect(b.acquirerSectors).toBe(2);
    expect(b.targetGone).toBe(true);
    const settlement = (await w.memory
      .collection("acquisitionSettlements")
      .findOne({ _id: w.offerId })) as unknown as AcquisitionSettlement | null;
    expect(settlement?.status).toBe("applied");
    expect(settlement?.legs.every((leg) => leg.applied)).toBe(true);
  });

  it("ledgers the acquirer outflow and both shell-cash legs", async () => {
    const w = buildAcquisitionWorld();
    const r = await executeAgreedAcquisition({
      db: w.db,
      offer: w.offer as never,
      currentTurn: 200,
    });
    expect(r.ok).toBe(true);

    const legs = vi.mocked(emitTx).mock.calls.map((c) => c[1]);
    const outflow = legs.find((l) => l.type === "share_buyout_outflow");
    expect(outflow).toBeDefined();
    expect(outflow?.amount).toBe(-1_000_000);
    expect((outflow?.subjectId as ObjectId).equals(w.acq)).toBe(true);

    // The shell's cash is not created or destroyed: it leaves the target and
    // lands on the acquirer, so the two legs must net to zero.
    const shellLegs = legs.filter((l) => l.type === "corp_dissolution_distribution");
    expect(shellLegs).toHaveLength(2);
    expect(shellLegs.reduce((sum, l) => sum + l.amount, 0)).toBe(0);
  });

  it("tags every holder ledger leg with the acquisition kind and turn", async () => {
    const w = buildAcquisitionWorld();
    await executeAgreedAcquisition({ db: w.db, offer: w.offer as never, currentTurn: 200 });
    const calls = vi.mocked(emitTx).mock.calls.map((c) => c[1]);
    const payouts = calls.filter((l) => l.type === "share_buyout_payout");
    // Four ledgered holder buckets (character x2, imperial, corporate, treasury).
    expect(payouts).toHaveLength(5);
    for (const leg of payouts) {
      expect(leg.turn).toBe(200);
      expect((leg.meta as Record<string, unknown>).kind).toBe("agreed_acquisition");
    }
  });

  it("moves the target bank to the acquirer instead of deleting it (ticket-1267)", async () => {
    const w = buildAcquisitionWorld({ charter: true });
    const r = await executeAgreedAcquisition({
      db: w.db,
      offer: w.offer as never,
      currentTurn: 200,
    });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.bankCharterTransferred).toBe(true);
    const balances = await readBalances(w);
    expect(balances.targetGone).toBe(true);
    const acquirer = await w.memory.collection("corporations").findOne({ _id: w.acq });
    expect(acquirer?.bankCharter).toMatchObject({ charteredTurn: 150, currency: "USD" });
    const tgtHex = w.tgt.toHexString();
    const acqHex = w.acq.toHexString();
    // Every satellite row re-keyed off the shell exactly once.
    expect(
      await w.memory.collection("bankLoans").countDocuments({ bankCorporationId: w.tgt })
    ).toBe(0);
    expect(
      await w.memory.collection("bankLoans").countDocuments({ bankCorporationId: w.acq })
    ).toBe(1);
    expect(
      await w.memory.collection("interbankLoans").countDocuments({
        $or: [{ lenderCorporationId: w.tgt }, { borrowerCorporationId: w.tgt }],
      })
    ).toBe(0);
    expect(await w.memory.collection("savingsAccounts").countDocuments({ holder: tgtHex })).toBe(0);
    expect(await w.memory.collection("savingsAccounts").countDocuments({ holder: acqHex })).toBe(1);
    expect(
      await w.memory
        .collection("characters")
        .countDocuments({ "currencyBalances.savingsHolder.USD": tgtHex })
    ).toBe(0);
  });

  it("blocks acquiring a banked target when the acquirer already operates a bank", async () => {
    const w = buildAcquisitionWorld({ charter: true, acquirerCharter: true });
    const r = await executeAgreedAcquisition({
      db: w.db,
      offer: w.offer as never,
      currentTurn: 200,
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/already operates a bank/);
      expect(r.status).toBe(400);
    }
    const balances = await readBalances(w);
    expect(balances.acquirer).toBe(ACQUIRER_CASH);
    expect(balances.charA).toBe(0);
    expect(balances.targetGone).toBe(false);
    expect(
      await w.memory.collection("acquisitionSettlements").countDocuments({ _id: w.offerId })
    ).toBe(0);
  });
});
