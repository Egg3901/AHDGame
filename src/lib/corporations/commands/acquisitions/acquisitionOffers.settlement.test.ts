/**
 * Offer-layer guard over the durable acquisition settlement (issue #2017).
 *
 * `resolveAcquisitionOfferStatus` (withdraw/reject) must compensate a running
 * settlement before closing the offer, and `acceptAcquisitionOffer` must close
 * terminal runs as `failed` (never back to `pending`) while leaving retryable
 * runs resumable. Every test is state-based: real executor, in-memory
 * collections, absolute balances. The suite imports the offers module (which
 * pulls the executor) on every run, so a module-cycle hang would fail here,
 * bounded by the repo's 15s per-test timeout.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildAcquisitionWorld,
  defaultSlices,
  readBalances,
  ACQUIRER_CASH,
  SHELL_CASH,
  type AcquisitionWorld,
} from "./acquisitionSettlementWorld";
import { withInjectedCrash, InjectedCrash, type WriteOp } from "@/lib/test-utils/faultyDb";

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
vi.mock("@/lib/corporations/mergerReview/gate", () => ({
  assertMergerClearance: vi.fn().mockResolvedValue({ ok: true }),
  acquisitionsBarredByDivestiture: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/corporations/mergerReview/lifecycle", () => ({
  attachMergerRemedy: vi.fn().mockResolvedValue(undefined),
}));

import { executeAgreedAcquisition } from "./executeAgreedAcquisition";
import { acceptAcquisitionOffer, resolveAcquisitionOfferStatus } from "./acquisitionOffers";
import { loadAcquisitionSettlement } from "./acquisitionSettlement";

type WriteEntry = { collection: string; op: WriteOp };

async function referenceLog(): Promise<WriteEntry[]> {
  const w = buildAcquisitionWorld({});
  const faulty = withInjectedCrash(w.memory, { onCall: Number.MAX_SAFE_INTEGER });
  const r = await executeAgreedAcquisition({
    db: faulty.db,
    offer: w.offer as never,
    currentTurn: 200,
  });
  expect(r.ok).toBe(true);
  return faulty.log;
}

/** Crash the executor mid-payout (debit plus two holder legs landed), offer untouched. */
async function crashMidPayout(): Promise<AcquisitionWorld> {
  const log = await referenceLog();
  const holderMoney = log
    .map((e, i) => ({ ...e, i }))
    .filter(
      (e) =>
        e.op === "updateOne" &&
        (e.collection === "characters" || e.collection === "imperialCharacters")
    );
  expect(holderMoney.length).toBeGreaterThanOrEqual(2);
  const world = buildAcquisitionWorld({});
  const faulty = withInjectedCrash(world.memory, {
    onCall: holderMoney[1].i + 2,
    afterWrite: true,
  });
  const crashed = await executeAgreedAcquisition({
    db: faulty.db,
    offer: world.offer as never,
    currentTurn: 200,
  }).catch((err) => err);
  expect(crashed).toBeInstanceOf(InjectedCrash);
  const settlement = await loadAcquisitionSettlement(world.db, world.offerId);
  expect(settlement?.status).toBe("in_progress");
  return world;
}

async function offerStatus(w: AcquisitionWorld): Promise<unknown> {
  return (await w.memory.collection("acquisitionOffers").findOne({ _id: w.offerId }))?.status;
}

describe("resolveAcquisitionOfferStatus over settlement states", () => {
  beforeEach(() => vi.clearAllMocks());

  it("withdraws a pending offer with no settlement without touching money", async () => {
    const w = buildAcquisitionWorld({});
    const r = await resolveAcquisitionOfferStatus(w.db, w.offer as never, "withdrawn", 200);
    expect(r).toMatchObject({ ok: true });
    expect(await offerStatus(w)).toBe("withdrawn");
    expect(
      await w.memory.collection("acquisitionSettlements").countDocuments({ _id: w.offerId })
    ).toBe(0);
    const b = await readBalances(w);
    expect(b.acquirer).toBe(ACQUIRER_CASH);
    expect(b.charA).toBe(0);
  });

  it("rejects a pending offer with no settlement without touching money", async () => {
    const w = buildAcquisitionWorld({});
    const r = await resolveAcquisitionOfferStatus(w.db, w.offer as never, "rejected", 200);
    expect(r).toMatchObject({ ok: true });
    expect(await offerStatus(w)).toBe("rejected");
    expect(
      await w.memory.collection("acquisitionSettlements").countDocuments({ _id: w.offerId })
    ).toBe(0);
  });

  it("withdraw compensates a running settlement: refund is exactly price-minus-delivered", async () => {
    const w = await crashMidPayout();
    const slices = defaultSlices(w.price);
    const r = await resolveAcquisitionOfferStatus(w.db, w.offer as never, "withdrawn", 200);
    expect(r).toMatchObject({ ok: true });
    expect(await offerStatus(w)).toBe("withdrawn");
    const settlement = await loadAcquisitionSettlement(w.db, w.offerId);
    expect(settlement?.status).toBe("compensated");
    // Two holder legs landed before the crash; the refund is the remainder.
    const delivered = slices.charA + slices.charB;
    expect(settlement?.refundTotal).toBe(w.price - delivered);
    const b = await readBalances(w);
    expect(b.charA).toBe(slices.charA);
    expect(b.charB).toBe(slices.charB);
    expect(b.imperial).toBe(0);
    expect(b.acquirer).toBe(ACQUIRER_CASH - w.price + (w.price - delivered));
    expect(b.targetGone).toBe(false);
    // The target claim is released and execution past the closure is terminal:
    // this is the compensated-guard path that must resolve, never hang.
    const target = await w.memory.collection("corporations").findOne({ _id: w.tgt });
    expect(target?.acquisitionSettlementId).toBeUndefined();
    const retry = await executeAgreedAcquisition({
      db: w.db,
      offer: w.offer as never,
      currentTurn: 200,
    });
    expect(retry).toMatchObject({ ok: false, status: 409, terminal: true });
    expect(await readBalances(w)).toEqual(b);
  });

  it("withdraw after shell cash landed unwinds exactly (marked and money-only windows)", async () => {
    // The shell credit created money on the acquirer without debiting the
    // target, so compensation must take it back acquirer-side only (never
    // credit the target, never shrink the price refund for it). Both crash
    // windows must converge: after the applied mark, and after the money
    // alone (flag clear, stamp present), which the compensation reconciles.
    for (const moneyOnly of [false, true]) {
      const log = await referenceLog();
      const fundWrites = log
        .map((e, i) => ({ ...e, i }))
        .filter((e) => e.collection === "indexFunds" && e.op === "updateOne");
      expect(fundWrites.length).toBeGreaterThanOrEqual(2);
      const shellIdx = log.findIndex(
        (e, i) =>
          i > fundWrites[fundWrites.length - 1].i &&
          e.collection === "corporations" &&
          e.op === "updateOne"
      );
      expect(shellIdx).toBeGreaterThan(0);
      expect(log[shellIdx + 1]).toMatchObject({
        collection: "acquisitionSettlements",
        op: "updateOne",
      });
      const world = buildAcquisitionWorld({});
      const faulty = withInjectedCrash(world.memory, {
        onCall: shellIdx + (moneyOnly ? 1 : 2),
        afterWrite: true,
      });
      const crashed = await executeAgreedAcquisition({
        db: faulty.db,
        offer: world.offer as never,
        currentTurn: 200,
      }).catch((err) => err);
      expect(crashed).toBeInstanceOf(InjectedCrash);

      const r = await resolveAcquisitionOfferStatus(
        world.db,
        world.offer as never,
        "withdrawn",
        200
      );
      expect(r).toMatchObject({ ok: true });
      expect(await offerStatus(world)).toBe("withdrawn");
      const settlement = await loadAcquisitionSettlement(world.db, world.offerId);
      expect(settlement?.status).toBe("compensated");
      // Every holder bucket landed before the shell cash, so the refund is
      // exactly price-minus-holders = 0; the shell take-back washes the rest.
      const slices = defaultSlices(world.price);
      expect(settlement?.refundTotal).toBe(0);
      const b = await readBalances(world);
      expect(b.charA).toBe(slices.charA);
      expect(b.charB).toBe(slices.charB);
      expect(b.imperial).toBe(slices.imperial);
      expect(b.corpHolder).toBe(1_000 + slices.corp);
      expect(b.fundCash).toBe(slices.fund);
      expect(b.treasury).toBe(slices.float);
      expect(b.acquirer).toBe(ACQUIRER_CASH - world.price);
      expect(b.targetGone).toBe(false);
      const target = await world.memory.collection("corporations").findOne({ _id: world.tgt });
      expect(target?.liquidCapital).toBe(SHELL_CASH);
      const retry = await executeAgreedAcquisition({
        db: world.db,
        offer: world.offer as never,
        currentTurn: 200,
      });
      expect(retry).toMatchObject({ ok: false, status: 409, terminal: true });
      expect(await readBalances(world)).toEqual(b);
    }
  });

  it("reject compensates a running settlement the same way withdraw does", async () => {
    const w = await crashMidPayout();
    const slices = defaultSlices(w.price);
    const r = await resolveAcquisitionOfferStatus(w.db, w.offer as never, "rejected", 200);
    expect(r).toMatchObject({ ok: true });
    expect(await offerStatus(w)).toBe("rejected");
    const settlement = await loadAcquisitionSettlement(w.db, w.offerId);
    expect(settlement?.status).toBe("compensated");
    expect(settlement?.refundTotal).toBe(w.price - (slices.charA + slices.charB));
    const retry = await executeAgreedAcquisition({
      db: w.db,
      offer: w.offer as never,
      currentTurn: 200,
    });
    expect(retry).toMatchObject({ ok: false, status: 409, terminal: true });
  });

  it("withdraw past a compensated settlement does not refund twice", async () => {
    const w = await crashMidPayout();
    const first = await resolveAcquisitionOfferStatus(w.db, w.offer as never, "withdrawn", 200);
    expect(first).toMatchObject({ ok: true });
    const settlement = await loadAcquisitionSettlement(w.db, w.offerId);
    expect(settlement?.status).toBe("compensated");
    const refundTotal = settlement?.refundTotal;
    const balances = await readBalances(w);
    // The offer is closed, so a second resolve is a 409 with nothing moved.
    const again = await resolveAcquisitionOfferStatus(
      w.db,
      { ...w.offer, status: "withdrawn" } as never,
      "withdrawn",
      200
    );
    expect(again).toMatchObject({ ok: false, status: 409 });
    expect((await loadAcquisitionSettlement(w.db, w.offerId))?.refundTotal).toBe(refundTotal);
    expect(await readBalances(w)).toEqual(balances);
  });

  it("withdraw on a committed (applied) offer is rejected and moves nothing", async () => {
    const w = buildAcquisitionWorld({});
    const accepted = await acceptAcquisitionOffer(w.db, {
      offer: w.offer as never,
      currentTurn: 200,
    });
    expect(accepted.ok).toBe(true);
    expect((await loadAcquisitionSettlement(w.db, w.offerId))?.status).toBe("applied");
    const balances = await readBalances(w);
    const r = await resolveAcquisitionOfferStatus(
      w.db,
      { ...w.offer, status: "accepted" } as never,
      "withdrawn",
      200
    );
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(await readBalances(w)).toEqual(balances);
  });
});

describe("acceptAcquisitionOffer settlement close-out", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a terminal failure closes the offer as failed, never back to pending", async () => {
    const w = buildAcquisitionWorld({});
    await w.memory.collection("imperialCharacters").deleteOne({ _id: w.imperial });
    const r = await acceptAcquisitionOffer(w.db, { offer: w.offer as never, currentTurn: 200 });
    expect(r.ok).toBe(false);
    expect(await offerStatus(w)).toBe("failed");
    const settlement = await loadAcquisitionSettlement(w.db, w.offerId);
    expect(settlement?.status).toBe("compensated");
    // The debit never landed (the plan was unpayable up front): full balance kept.
    const b = await readBalances(w);
    expect(b.acquirer).toBe(ACQUIRER_CASH);
    expect(b.charA).toBe(0);
    // Closed offers do not re-open: re-accept is a 409, execution is terminal.
    const reAccept = await acceptAcquisitionOffer(w.db, {
      offer: w.offer as never,
      currentTurn: 200,
    });
    expect(reAccept).toMatchObject({ ok: false, status: 409 });
    const retry = await executeAgreedAcquisition({
      db: w.db,
      offer: w.offer as never,
      currentTurn: 200,
    });
    expect(retry).toMatchObject({ ok: false, status: 409, terminal: true });
  });

  it("a retryable failure returns the offer to pending and succeeds on re-accept", async () => {
    const w = buildAcquisitionWorld({ acquirerCash: 100 });
    const r = await acceptAcquisitionOffer(w.db, { offer: w.offer as never, currentTurn: 200 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/insufficient corporate funds/i);
    expect(await offerStatus(w)).toBe("pending");
    // Fund the acquirer and re-accept: the pinned record replays, no double-pay.
    await w.memory
      .collection("corporations")
      .updateOne({ _id: w.acq }, { $set: { liquidCapital: ACQUIRER_CASH } });
    const retry = await acceptAcquisitionOffer(w.db, { offer: w.offer as never, currentTurn: 200 });
    expect(retry.ok).toBe(true);
    const b = await readBalances(w);
    expect(b.acquirer).toBe(ACQUIRER_CASH - w.price + w.shellCash);
    expect(b.charA).toBe(defaultSlices(w.price).charA);
    expect(b.targetGone).toBe(true);
    expect((await loadAcquisitionSettlement(w.db, w.offerId))?.status).toBe("applied");
  });
});
