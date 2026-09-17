/**
 * Fault-injection, replay, and recovery coverage for the durable agreed-
 * acquisition settlement (issue #2017).
 *
 * Strategy: run the real executor against the in-memory collections, crash
 * after every durable write in the observed write order, then retry clean on
 * the same state. Every retry must converge to the same exactly-once success.
 * Money assertions are absolute balances, so a double-pay cannot hide behind
 * a mock.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import {
  buildAcquisitionWorld,
  defaultSlices,
  readBalances,
  ACQUIRER_CASH,
  type AcquisitionWorld,
} from "./acquisitionSettlementWorld";
import {
  withInjectedCrash,
  InjectedCrash,
  type FaultPlan,
  type WriteOp,
} from "@/lib/test-utils/faultyDb";

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
import { loadAcquisitionSettlement } from "./acquisitionSettlement";
import { resolveAcquisitionOfferStatus } from "./acquisitionOffers";
import { allocateShareholderPool } from "@/lib/bonds/corporateBondDefault";
import { emitTx } from "@/lib/financialTxLog/emit";

type WriteEntry = { collection: string; op: WriteOp };

/** Crash AFTER the Nth write overall (0-based index into the write log). */
function crashAfter(index: number): FaultPlan {
  return { onCall: index + 1, afterWrite: true };
}

async function referenceLog(opts: Parameters<typeof buildAcquisitionWorld>[0]): Promise<WriteEntry[]> {
  const w = buildAcquisitionWorld(opts);
  const faulty = withInjectedCrash(w.memory, { onCall: Number.MAX_SAFE_INTEGER });
  const r = await executeAgreedAcquisition({ db: faulty.db, offer: w.offer as never, currentTurn: 200 });
  expect(r.ok).toBe(true);
  return faulty.log;
}

async function crashThenRetry(
  opts: Parameters<typeof buildAcquisitionWorld>[0],
  plan: FaultPlan,
  mutate?: (w: AcquisitionWorld) => void | Promise<void>
): Promise<{ world: AcquisitionWorld; first: unknown; second: unknown }> {
  const world = buildAcquisitionWorld(opts);
  const faulty = withInjectedCrash(world.memory, plan);
  const first = await executeAgreedAcquisition({
    db: faulty.db,
    offer: world.offer as never,
    currentTurn: 200,
  }).catch((err) => err);
  expect(first).toBeInstanceOf(InjectedCrash);
  await mutate?.(world);
  // The fault disarms after firing once, so the same handle runs clean now.
  const second = await executeAgreedAcquisition({
    db: faulty.db,
    offer: world.offer as never,
    currentTurn: 200,
  });
  return { world, first, second };
}

async function expectExactlyOnceSuccess(w: AcquisitionWorld, sectorCount: number): Promise<void> {
  const slices = defaultSlices(w.price);
  const b = await readBalances(w);
  expect(b.acquirer).toBe(ACQUIRER_CASH - w.price + w.shellCash);
  expect(b.charA).toBe(slices.charA);
  expect(b.charB).toBe(slices.charB);
  expect(b.imperial).toBe(slices.imperial);
  expect(b.corpHolder).toBe(1_000 + slices.corp);
  expect(b.fundCash).toBe(slices.fund);
  expect(b.fundHoldings).toBe(0);
  expect(b.treasury).toBe(slices.float);
  expect(b.acquirerSectors).toBe(sectorCount);
  expect(b.targetGone).toBe(true);
  const settlement = await loadAcquisitionSettlement(w.db, w.offerId);
  expect(settlement?.status).toBe("applied");
  expect(settlement?.legs.every((leg) => leg.applied)).toBe(true);
}

describe("settlement crash recovery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resumes to exactly-once success after a crash past any durable write (no charter)", async () => {
    const log = await referenceLog({});
    expect(log.length).toBeGreaterThan(20);
    const failures: string[] = [];
    for (let n = 0; n < log.length; n += 1) {
      const { world, second } = await crashThenRetry({}, crashAfter(n));
      try {
        expect(second).toMatchObject({ ok: true });
        await expectExactlyOnceSuccess(world, 1);
      } catch (err) {
        failures.push(`crash-after #${n} (${log[n].collection}.${log[n].op}): ${(err as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("resumes to exactly-once success after a crash past any durable write (banked target)", async () => {
    const log = await referenceLog({ charter: true });
    // Crashes inside the charter transfer's own claim/release/re-key window
    // belong to its recovery protocol (PR #2016, issue #2014): the money below
    // still converges exactly once, but satellite convergence for those
    // indices is #2016's to prove, so this sweep asserts money only there.
    // The claim index itself cannot converge pre-#2016 (named test below);
    // every other index converges fully, charter and satellites included.
    const claim = log.findIndex(
      (e, i) =>
        e.collection === "corporations" &&
        e.op === "updateOne" &&
        log[i + 1]?.collection === "corporations" &&
        log[i + 1]?.op === "updateOne"
    );
    expect(claim).toBeGreaterThanOrEqual(0);
    const progressAfter = log.findIndex(
      (e, i) => i > claim && e.collection === "acquisitionSettlements"
    );
    const transferWindow = new Set(
      log.map((_, i) => i).filter((i) => i >= claim && i < progressAfter)
    );
    const failures: string[] = [];
    for (let n = 0; n < log.length; n += 1) {
      if (n === claim) continue;
      const { world, second } = await crashThenRetry({ charter: true }, crashAfter(n));
      try {
        expect(second).toMatchObject({ ok: true });
        await expectExactlyOnceSuccess(world, 1);
        if (!transferWindow.has(n)) {
          const acquirer = await world.memory.collection("corporations").findOne({ _id: world.acq });
          expect(acquirer?.bankCharter).toMatchObject({ charteredTurn: 150 });
          expect(
            await world.memory
              .collection("bankLoans")
              .countDocuments({ bankCorporationId: world.tgt })
          ).toBe(0);
        }
      } catch (err) {
        failures.push(`crash-after #${n} (${log[n].collection}.${log[n].op}): ${(err as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("degrades safely (no compounding) on the pre-#2016 charter-claim window", async () => {
    const log = await referenceLog({ charter: true });
    const claim = log.findIndex(
      (e, i) =>
        e.collection === "corporations" &&
        e.op === "updateOne" &&
        log[i + 1]?.collection === "corporations" &&
        log[i + 1]?.op === "updateOne"
    );
    expect(claim).toBeGreaterThanOrEqual(0);
    const { world, second } = await crashThenRetry({ charter: true }, crashAfter(claim));
    // Retryable, never terminal: only the debit landed, nobody was paid.
    expect(second).toMatchObject({ ok: false, status: 500 });
    expect((second as { terminal?: boolean }).terminal).not.toBe(true);
    const firstBalances = await readBalances(world);
    expect(firstBalances.acquirer).toBe(ACQUIRER_CASH - world.price);
    expect(firstBalances.charA).toBe(0);
    // A further retry reports the same error and moves no more money.
    const again = await executeAgreedAcquisition({ db: world.db, offer: world.offer as never, currentTurn: 200 });
    expect(again).toMatchObject({ ok: false, status: 500 });
    expect(await readBalances(world)).toEqual(firstBalances);
    const settlement = await loadAcquisitionSettlement(world.db, world.offerId);
    expect(settlement?.status).toBe("in_progress");
  });

  it("survives a crash before the settlement claim is even written", async () => {
    const { world, second } = await crashThenRetry({}, { collection: "acquisitionSettlements", op: "insertOne", onCall: 1 });
    expect(second).toMatchObject({ ok: true });
    await expectExactlyOnceSuccess(world, 1);
  });

  it("finishes the commit tail when the shell is deleted but its flag is not marked", async () => {
    const log = await referenceLog({});
    const shellDeletedMarks = log.filter(
      (e) => e.collection === "acquisitionSettlements" && e.op === "updateOne"
    ).length;
    // Crash BEFORE the last-but-one settlement mark (shellDeleted): the shell
    // row is already gone while the flag still says otherwise.
    const { world, second } = await crashThenRetry(
      {},
      { collection: "acquisitionSettlements", op: "updateOne", onCall: shellDeletedMarks - 1 }
    );
    expect(second).toMatchObject({ ok: true });
    await expectExactlyOnceSuccess(world, 1);
    const settlement = await loadAcquisitionSettlement(world.db, world.offerId);
    expect(settlement?.shellDeleted).toBe(true);
  });

  it("returns the recorded result when the retry lands after the commit mark", async () => {
    const log = await referenceLog({});
    const { world, second } = await crashThenRetry({}, crashAfter(log.length - 1));
    expect(second).toMatchObject({ ok: true });
    await expectExactlyOnceSuccess(world, 1);
    // Post-commit work is a pure re-read: no holder is credited again and no
    // ledger leg re-emits.
    const before = await readBalances(world);
    vi.mocked(emitTx).mockClear();
    const again = await executeAgreedAcquisition({ db: world.db, offer: world.offer as never, currentTurn: 200 });
    expect(again).toEqual(second);
    expect(await readBalances(world)).toEqual(before);
    expect(vi.mocked(emitTx)).not.toHaveBeenCalled();
  });
});

describe("partial-holder payout recovery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pays the remaining holders exactly once after crashing with two legs landed", async () => {
    const log = await referenceLog({});
    const holderMoney = log
      .map((e, i) => ({ ...e, i }))
      .filter(
        (e) => e.op === "updateOne" && (e.collection === "characters" || e.collection === "imperialCharacters")
      );
    expect(holderMoney.length).toBeGreaterThanOrEqual(2);
    // Crash right after the mark that follows the second holder money write:
    // two holders paid, everything else pending. (The reference run above
    // also emits ledgers through the shared mock, so clear it first.)
    vi.mocked(emitTx).mockClear();
    const { world, second } = await crashThenRetry({}, crashAfter(holderMoney[1].i + 1));
    expect(second).toMatchObject({ ok: true });
    await expectExactlyOnceSuccess(world, 1);
    // Ledgers still emitted exactly once per leg across the crash and retry.
    const calls = vi.mocked(emitTx).mock.calls.map((c) => c[1]);
    expect(calls.filter((l) => l.type === "share_buyout_payout")).toHaveLength(5);
    expect(calls.filter((l) => l.type === "share_buyout_outflow")).toHaveLength(1);
    expect(calls.filter((l) => l.type === "corp_dissolution_distribution")).toHaveLength(2);
  });
});

describe("concurrent execution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("two concurrent same-offer executions pay every holder exactly once", async () => {
    const w = buildAcquisitionWorld({});
    const [first, second] = await Promise.all([
      executeAgreedAcquisition({ db: w.db, offer: w.offer as never, currentTurn: 200 }),
      executeAgreedAcquisition({ db: w.db, offer: { ...w.offer } as never, currentTurn: 200 }),
    ]);
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    await expectExactlyOnceSuccess(w, 1);
  });

  it("a second offer for a claimed target stops at 409 while the first can still finish", async () => {
    const w = buildAcquisitionWorld({});
    const faulty = withInjectedCrash(w.memory, crashAfter(3));
    const crashed = await executeAgreedAcquisition({
      db: faulty.db,
      offer: w.offer as never,
      currentTurn: 200,
    }).catch((err) => err);
    expect(crashed).toBeInstanceOf(InjectedCrash);

    const rivalOffer = { ...w.offer, _id: new ObjectId() };
    const rival = await executeAgreedAcquisition({ db: faulty.db, offer: rivalOffer as never, currentTurn: 200 });
    expect(rival).toMatchObject({ ok: false, status: 409 });

    const retry = await executeAgreedAcquisition({ db: faulty.db, offer: w.offer as never, currentTurn: 200 });
    expect(retry).toMatchObject({ ok: true });
    await expectExactlyOnceSuccess(w, 1);
  });
});

describe("terminal failure and compensation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("compensates exactly price-minus-delivered when a holder vanishes mid-payout", async () => {
    const log = await referenceLog({});
    const holderMoney = log
      .map((e, i) => ({ ...e, i }))
      .filter(
        (e) => e.op === "updateOne" && (e.collection === "characters" || e.collection === "imperialCharacters")
      );
    const slices = defaultSlices(1_000_000);
    const { world, second } = await crashThenRetry(
      {},
      crashAfter(holderMoney[1].i + 1),
      async (w) => {
        await w.memory.collection("imperialCharacters").deleteOne({ _id: w.imperial });
      }
    );
    expect(second).toMatchObject({ ok: false, terminal: true, status: 500 });
    const delivered = slices.charA + slices.charB;
    const b = await readBalances(world);
    // Paid holders keep their slices; the acquirer is refunded the remainder.
    expect(b.charA).toBe(slices.charA);
    expect(b.charB).toBe(slices.charB);
    expect(b.acquirer).toBe(ACQUIRER_CASH - 1_000_000 + (1_000_000 - delivered));
    expect(b.targetGone).toBe(false);
    const settlement = await loadAcquisitionSettlement(world.db, world.offerId);
    expect(settlement?.status).toBe("compensated");
    expect(settlement?.refundTotal).toBe(1_000_000 - delivered);
  });

  it("still closes the settlement when the acquirer is gone and the refund cannot land", async () => {
    const { world, second } = await crashThenRetry({}, crashAfter(3), async (w) => {
      await w.memory.collection("corporations").deleteOne({ _id: w.acq });
    });
    expect(second).toMatchObject({ ok: false, status: 404, terminal: true });
    const settlement = await loadAcquisitionSettlement(world.db, world.offerId);
    expect(settlement?.status).toBe("compensated");
    expect(settlement?.refundTotal).toBe(0);
    expect(settlement?.error).toMatch(/could not be applied/);
  });

  it("refuses to resume a compensated settlement", async () => {
    const world = buildAcquisitionWorld({});
    const faulty = withInjectedCrash(world.memory, crashAfter(3));
    const crashed = await executeAgreedAcquisition({
      db: faulty.db,
      offer: world.offer as never,
      currentTurn: 200,
    }).catch((err) => err);
    expect(crashed).toBeInstanceOf(InjectedCrash);
    const withdrawn = await resolveAcquisitionOfferStatus(world.db, world.offer as never, "withdrawn", 200);
    expect(withdrawn).toMatchObject({ ok: true });
    // The debit was refunded by the withdrawal; execution past the closure is
    // terminal and moves nothing further.
    const retry = await executeAgreedAcquisition({ db: faulty.db, offer: world.offer as never, currentTurn: 200 });
    expect(retry).toMatchObject({ ok: false, status: 409, terminal: true });
    const b = await readBalances(world);
    expect(b.charA).toBe(0);
    expect(b.acquirer).toBe(ACQUIRER_CASH);
    const settlement = await loadAcquisitionSettlement(world.db, world.offerId);
    expect(settlement?.status).toBe("compensated");
  });

  it("rejects a settlement claim that disagrees with the pinned record", async () => {
    const w = buildAcquisitionWorld({});
    const { claimAcquisitionSettlement } = await import("./acquisitionSettlement");
    const spec = {
      offerId: w.offerId,
      acquirerHex: w.acq.toHexString(),
      targetHex: w.tgt.toHexString(),
      acquirerName: "AcquireCo",
      targetName: "TargetCo",
      priceAnchor: 1_000_000,
      priceInAcquirerCapital: 1_000_000,
      acquirerCurrency: "USD",
      shellCashTargetLocal: 0,
      targetCurrency: "USD",
      plan: { key: "k", legs: [], unpayable: [] },
    };
    const first = await claimAcquisitionSettlement(w.db, spec);
    expect(first.fresh).toBe(true);
    const replay = await claimAcquisitionSettlement(w.db, spec);
    expect(replay.fresh).toBe(false);
    await expect(claimAcquisitionSettlement(w.db, { ...spec, priceAnchor: 2 })).rejects.toThrow(
      /disagrees with this offer/
    );
  });
});

describe("pinned payout math", () => {
  beforeEach(() => vi.clearAllMocks());

  it("credits exactly what allocateShareholderPool pins, per bucket", async () => {
    const w = buildAcquisitionWorld({});
    const target = await w.memory.collection("corporations").findOne({ _id: w.tgt });
    const allocation = allocateShareholderPool(target as never, w.price, new Map());
    const r = await executeAgreedAcquisition({ db: w.db, offer: w.offer as never, currentTurn: 200 });
    expect(r.ok).toBe(true);
    const settlement = await loadAcquisitionSettlement(w.db, w.offerId);
    const anchorByKey = new Map((settlement?.legs ?? []).map((leg) => [leg.key, leg.payoutAnchor]));
    for (const row of allocation.characterRows) {
      const key = `holder:${row.isImperial ? "imperial" : "character"}:${row.characterId}`;
      expect(anchorByKey.get(key)).toBe(row.payout);
    }
    for (const row of allocation.corporationRows) {
      expect(anchorByKey.get(`holder:corporation:${row.corporationId}`)).toBe(row.payout);
    }
    for (const row of allocation.fundRows) {
      expect(anchorByKey.get(`holder:fund:${row.fundId}`)).toBe(row.payout);
    }
    if (allocation.publicFloatRow) {
      expect(anchorByKey.get("holder:treasury")).toBe(allocation.publicFloatRow.payout);
    }
  });

  it("replicates the floor-dust quirk instead of fixing it", async () => {
    const w = buildAcquisitionWorld({ price: 1_000_007 });
    const r = await executeAgreedAcquisition({ db: w.db, offer: w.offer as never, currentTurn: 200 });
    expect(r.ok).toBe(true);
    const b = await readBalances(w);
    const delivered = b.charA + b.charB + b.imperial + (b.corpHolder - 1_000) + b.fundCash + b.treasury;
    // Per-row Math.floor leaves dust with no recipient, exactly as the legacy
    // payout did: the acquirer paid the full price, holders share the rest.
    expect(delivered).toBeLessThan(w.price);
    expect(b.acquirer).toBe(ACQUIRER_CASH - w.price + w.shellCash);
    expect(w.price - delivered).toBe(3);
  });
});
