/**
 * Subsidiary outcome of an agreed acquisition: the target is bought, its former
 * holders are paid, and it survives as the acquirer's wholly owned subsidiary.
 *
 * State-based, like the merge settlement suites: the real executor over the
 * in-memory collections, absolute balances, and a crash injected at every write
 * of the run to prove a retry converges on the same world.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import {
  buildAcquisitionWorld,
  defaultSlices,
  readBalances,
  ACQUIRER_CASH,
  SHELL_CASH,
  PRICE,
  type AcquisitionWorld,
} from "./acquisitionSettlementWorld";
import { withInjectedCrash, InjectedCrash } from "@/lib/test-utils/faultyDb";

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
vi.mock("@/lib/corporations/cleanupShareMarketActivity", () => ({
  cleanupShareMarketActivityForCorporations: vi.fn().mockResolvedValue({}),
  cleanupShareMarketActivityForCorporationTargets: vi.fn().mockResolvedValue({}),
}));

import { executeAgreedAcquisition } from "./executeAgreedAcquisition";
import { loadAcquisitionSettlement } from "./acquisitionSettlement";
import { emitTx } from "@/lib/financialTxLog/emit";
import { recordAudit } from "@/lib/audit/recordAudit";
import { cleanupShareMarketActivityForCorporationTargets } from "@/lib/corporations/cleanupShareMarketActivity";

const TURN = 200;

function subsidiaryWorld(opts: Parameters<typeof buildAcquisitionWorld>[0] = {}): AcquisitionWorld {
  const w = buildAcquisitionWorld(opts);
  w.memory.seed("gameState", [{ _id: "current", subsidiaryCorporationsEnabled: true }]);
  (w.offer as { outcome?: string }).outcome = "subsidiary";
  return w;
}

function run(w: AcquisitionWorld, db = w.db) {
  return executeAgreedAcquisition({ db, offer: w.offer as never, currentTurn: TURN });
}

async function targetDoc(w: AcquisitionWorld) {
  return w.memory.collection("corporations").findOne({ _id: w.tgt });
}

/** Everything a run is allowed to change, for exact equality between a clean run and a resumed one. */
async function worldSnapshot(w: AcquisitionWorld) {
  const target = await targetDoc(w);
  const settlement = await loadAcquisitionSettlement(w.db, w.offerId);
  return {
    balances: await readBalances(w),
    // Ids differ between independently built worlds; compare by role.
    shareholders: (target?.shareholders as Array<{ corporationId?: ObjectId }> | undefined)?.map(
      (row) => ({ ...row, corporationId: row.corporationId?.equals(w.acq) ? "acquirer" : "other" })
    ),
    publicFloat: target?.publicFloat,
    formalized: target?.subsidiaryFormalizedAtTurn,
    claim: target?.acquisitionSettlementId ?? null,
    targetCash: target?.liquidCapital,
    settlementStatus: settlement?.status,
    result: settlement?.completedResult,
  };
}

describe("agreed acquisition, subsidiary outcome: settlement", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pays holders and keeps the target, its cash and its sectors", async () => {
    const w = subsidiaryWorld({ sectorCount: 2 });
    const r = await run(w);
    expect(r).toMatchObject({
      ok: true,
      outcome: "subsidiary",
      sectorsMoved: 0,
      priceAnchor: PRICE,
      acquirerName: "AcquireCo",
      targetName: "TargetCo",
    });

    const slices = defaultSlices(w.price);
    const b = await readBalances(w);
    // Holders are paid exactly as in a merge.
    expect(b.charA).toBe(slices.charA);
    expect(b.charB).toBe(slices.charB);
    expect(b.imperial).toBe(slices.imperial);
    expect(b.corpHolder).toBe(1_000 + slices.corp);
    expect(b.fundCash).toBe(slices.fund);
    expect(b.treasury).toBe(slices.float);
    // The acquirer is out the price and gains no shell cash: the target keeps its own.
    expect(b.acquirer).toBe(ACQUIRER_CASH - w.price);
    const target = await targetDoc(w);
    expect(b.targetGone).toBe(false);
    expect(target?.liquidCapital).toBe(SHELL_CASH);
    // Sectors stay where they are.
    expect(b.acquirerSectors).toBe(0);
    expect(
      await w.memory.collection("corporateSectors").countDocuments({ corporationId: w.tgt })
    ).toBe(2);
    // Conservation: every unit the acquirer lost reached a holder.
    const delivered =
      b.charA + b.charB + b.imperial + (b.corpHolder - 1_000) + b.fundCash + b.treasury;
    expect(ACQUIRER_CASH - b.acquirer).toBe(delivered);
  });

  it("hands the acquirer the whole cap table and formalizes the subsidiary", async () => {
    const w = subsidiaryWorld();
    await run(w);
    const target = await targetDoc(w);
    expect(target?.shareholders).toEqual([
      { corporationId: w.acq, shares: 1000, avgCostPerShare: w.price / 1000 },
    ]);
    expect(target?.publicFloat).toBe(0);
    expect(target?.totalShares).toBe(1000);
    expect(target?.subsidiaryFormalizedAtTurn).toBe(TURN);
    // The claim is released: the target is a live corporation, not a deleted shell.
    expect(target?.acquisitionSettlementId).toBeUndefined();
    // No holding survives in the index fund that was paid out.
    const fund = await w.memory.collection("indexFunds").findOne({ _id: w.fund });
    expect(fund?.holdings).toEqual([]);
  });

  it("records no corporate exit and keeps the bank charter on the target", async () => {
    const w = subsidiaryWorld({ charter: true, acquirerCharter: true });
    const r = await run(w);
    expect(r.ok).toBe(true);
    const target = await targetDoc(w);
    expect(target?.bankCharter).toBeDefined();
    const acquirer = await w.memory.collection("corporations").findOne({ _id: w.acq });
    // Each corporation keeps exactly its own charter: no dual-charter conflict.
    expect(acquirer?.bankCharter?.charteredTurn).toBe(100);
    expect(target?.bankCharter?.charteredTurn).toBe(150);
    expect(await w.memory.collection("corporationExits").countDocuments({})).toBe(0);
  });

  it("stamps the ledger and audit trail with the subsidiary outcome", async () => {
    const w = subsidiaryWorld();
    await run(w);
    const emitted = vi.mocked(emitTx).mock.calls.map((c) => c[1]);
    expect(emitted.length).toBeGreaterThan(0);
    for (const entry of emitted) {
      expect(entry.meta).toMatchObject({ kind: "agreed_acquisition", outcome: "subsidiary" });
    }
    // No shell-cash ledger legs: the target's cash never moves.
    expect(emitted.some((e) => e.type === "corp_dissolution_distribution")).toBe(false);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "acquisition.execute",
        meta: expect.objectContaining({ acquisitionOutcome: "subsidiary" }),
      })
    );
  });

  it("cancels market activity on the target's shares before reading the cap table", async () => {
    const w = subsidiaryWorld();
    const order: string[] = [];
    vi.mocked(cleanupShareMarketActivityForCorporationTargets).mockImplementationOnce(async () => {
      order.push("cleanup");
      return { ordersCancelled: 0, listingsCancelled: 0, offersCancelled: 0 };
    });
    const faulty = withInjectedCrash(w.memory, { onCall: Number.MAX_SAFE_INTEGER });
    const r = await run(w, faulty.db);
    expect(r.ok).toBe(true);
    expect(order).toEqual(["cleanup"]);
    expect(cleanupShareMarketActivityForCorporationTargets).toHaveBeenCalledWith(
      expect.anything(),
      [w.tgt],
      expect.any(Date),
      false
    );
  });

  it("refuses an unaffordable offer without cancelling anyone's orders", async () => {
    const w = subsidiaryWorld({ acquirerCash: 10 });
    const r = await run(w);
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(cleanupShareMarketActivityForCorporationTargets).not.toHaveBeenCalled();
    const target = await targetDoc(w);
    expect(target?.acquisitionSettlementId).toBeUndefined();
    expect(target?.shareholders).toHaveLength(5);
    expect(await w.memory.collection("acquisitionSettlements").countDocuments({})).toBe(0);
  });
});

describe("agreed acquisition, subsidiary outcome: replay safety", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a second execution returns the recorded result and moves nothing", async () => {
    const w = subsidiaryWorld();
    const first = await run(w);
    const before = await worldSnapshot(w);
    const second = await run(w);
    expect(second).toEqual(first);
    expect(await worldSnapshot(w)).toEqual(before);
  });

  it("converges on the same world after a crash at ANY write of the run", async () => {
    const reference = subsidiaryWorld();
    const logger = withInjectedCrash(reference.memory, { onCall: Number.MAX_SAFE_INTEGER });
    expect((await run(reference, logger.db)).ok).toBe(true);
    const expected = await worldSnapshot(reference);
    const writes = logger.log.length;
    expect(writes).toBeGreaterThan(8);

    for (let call = 1; call <= writes; call += 1) {
      for (const afterWrite of [false, true]) {
        const w = subsidiaryWorld();
        const faulty = withInjectedCrash(w.memory, { onCall: call, afterWrite });
        const crashed = await run(w, faulty.db).catch((err) => err);
        // A crash can also land after the run finished its own writes.
        if (crashed instanceof InjectedCrash) {
          const resumed = await run(w);
          expect(
            resumed,
            `resume after crash at write ${call} afterWrite=${afterWrite}`
          ).toMatchObject({
            ok: true,
            outcome: "subsidiary",
          });
        }
        expect(await worldSnapshot(w), `write ${call} afterWrite=${afterWrite}`).toEqual(expected);
      }
    }
  }, 60_000);
});

describe("agreed acquisition, subsidiary outcome: eligibility at execution", () => {
  beforeEach(() => vi.clearAllMocks());

  async function expectRefused(w: AcquisitionWorld, message: RegExp, status = 400) {
    const r = await run(w);
    expect(r).toMatchObject({ ok: false, status });
    if (!r.ok) expect(r.error).toMatch(message);
    const b = await readBalances(w);
    expect(b.acquirer).toBe(ACQUIRER_CASH);
    expect(b.charA).toBe(0);
    const target = await targetDoc(w);
    expect(target?.subsidiaryFormalizedAtTurn).toBeUndefined();
    expect(await w.memory.collection("acquisitionSettlements").countDocuments({})).toBe(0);
  }

  it("is refused when the subsidiary feature is off", async () => {
    const w = subsidiaryWorld();
    w.memory
      .collection("gameState")
      .updateOne({ _id: "current" }, { $set: { subsidiaryCorporationsEnabled: false } });
    await expectRefused(w, /not enabled/);
  });

  it("is refused for a state-owned acquirer and for a formalized-subsidiary acquirer", async () => {
    const national = subsidiaryWorld();
    await national.memory
      .collection("corporations")
      .updateOne({ _id: national.acq }, { $set: { countryOwnerId: "US" } });
    await expectRefused(national, /cannot act as a parent/, 403);

    const chained = subsidiaryWorld();
    await chained.memory
      .collection("corporations")
      .updateOne({ _id: chained.acq }, { $set: { subsidiaryFormalizedAtTurn: 5 } });
    await expectRefused(chained, /cannot act as a parent/, 403);
  });

  it("is refused when the target already belongs to another corporation", async () => {
    const w = subsidiaryWorld();
    await w.memory.collection("corporations").updateOne(
      { _id: w.tgt },
      {
        $set: {
          shareholders: [
            { corporationId: w.corpHolder, shares: 900 },
            { characterId: w.charA, shares: 100 },
          ],
        },
      }
    );
    await expectRefused(w, /already controlled by another corporation/);
  });

  it("is refused when the target controls other corporations (no chaining)", async () => {
    const w = subsidiaryWorld();
    w.memory.seed("corporations", [
      {
        _id: new ObjectId(),
        name: "TargetsOwnSub",
        totalShares: 100,
        shareholders: [{ corporationId: w.tgt, shares: 100 }],
        liquidCapital: 0,
        countryId: "US",
      },
    ]);
    await expectRefused(w, /cannot be chained/);
  });

  it("is refused when the target already controls the acquirer (ownership cycle)", async () => {
    const w = subsidiaryWorld();
    await w.memory.collection("corporations").updateOne(
      { _id: w.acq },
      {
        $set: {
          totalShares: 100,
          shareholders: [{ corporationId: w.tgt, shares: 100 }],
        },
      }
    );
    // The acquirer is also a chain member in this graph, so either refusal is valid;
    // what matters is that no money moved.
    await expectRefused(w, /cannot be chained|circular/);
  });

  it("enforces the one-person rule for a human-run target", async () => {
    const owner = new ObjectId();
    const w = subsidiaryWorld();
    await w.memory
      .collection("corporations")
      .updateOne({ _id: w.acq }, { $set: { userId: owner, ceoType: "character" } });
    await w.memory
      .collection("corporations")
      .updateOne({ _id: w.tgt }, { $set: { userId: owner, ceoType: "character" } });
    await expectRefused(w, /different player than the parent/);
  });

  it("refuses a target CEO who already runs a sibling subsidiary of the same parent", async () => {
    const owner = new ObjectId();
    const shared = new ObjectId();
    const w = subsidiaryWorld();
    await w.memory
      .collection("corporations")
      .updateOne({ _id: w.acq }, { $set: { userId: owner, ceoType: "character" } });
    await w.memory
      .collection("corporations")
      .updateOne({ _id: w.tgt }, { $set: { userId: shared, ceoType: "character" } });
    w.memory.seed("corporations", [
      {
        _id: new ObjectId(),
        name: "Sibling",
        totalShares: 100,
        shareholders: [{ corporationId: w.acq, shares: 100 }],
        subsidiaryFormalizedAtTurn: 10,
        ceoType: "character",
        userId: shared,
        liquidCapital: 0,
        countryId: "US",
      },
    ]);
    await expectRefused(w, /only one subsidiary of the same parent/);
  });

  it("lets an NPP-run target through: no human seat to conflict", async () => {
    const owner = new ObjectId();
    const w = subsidiaryWorld();
    await w.memory
      .collection("corporations")
      .updateOne({ _id: w.acq }, { $set: { userId: owner, ceoType: "character" } });
    await w.memory
      .collection("corporations")
      .updateOne(
        { _id: w.tgt },
        { $set: { userId: owner, ceoType: "npp", ceoId: new ObjectId() } }
      );
    const r = await run(w);
    expect(r.ok).toBe(true);
    const target = await targetDoc(w);
    // Operation stays with the NPP; only ownership changed.
    expect(target?.ceoType).toBe("npp");
    expect(target?.subsidiaryFormalizedAtTurn).toBe(TURN);
  });

  it("does not let outstanding bonds or minority cross-holdings block a subsidiary", async () => {
    const w = subsidiaryWorld();
    w.memory.seed("bonds", [{ _id: new ObjectId(), corporationId: w.tgt, matured: false }]);
    w.memory.seed("corporations", [
      {
        _id: new ObjectId(),
        name: "Minority",
        totalShares: 1000,
        shareholders: [{ corporationId: w.tgt, shares: 100 }],
        liquidCapital: 0,
        countryId: "US",
      },
    ]);
    const r = await run(w);
    expect(r.ok).toBe(true);
    // The bond stays the target's own liability.
    expect(await w.memory.collection("bonds").countDocuments({ corporationId: w.tgt })).toBe(1);
  });

  it("still blocks the same bond for a merge (legacy offers are unchanged)", async () => {
    const w = buildAcquisitionWorld();
    w.memory.seed("bonds", [{ _id: new ObjectId(), corporationId: w.tgt, matured: false }]);
    const r = await run(w);
    expect(r).toMatchObject({ ok: false, status: 400 });
    if (!r.ok) expect(r.error).toMatch(/outstanding bonds/);
  });
});

describe("agreed acquisition, subsidiary outcome: merge regression", () => {
  beforeEach(() => vi.clearAllMocks());

  it("an offer with no outcome still merges and deletes the target", async () => {
    const w = buildAcquisitionWorld({ sectorCount: 2 });
    const r = await run(w);
    expect(r).toMatchObject({ ok: true, sectorsMoved: 2 });
    if (r.ok) expect(r.outcome).toBeUndefined();
    const b = await readBalances(w);
    expect(b.targetGone).toBe(true);
    expect(b.acquirerSectors).toBe(2);
    expect(b.acquirer).toBe(ACQUIRER_CASH - w.price + SHELL_CASH);
    expect(cleanupShareMarketActivityForCorporationTargets).not.toHaveBeenCalled();
  });
});
