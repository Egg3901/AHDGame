import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
} from "@/lib/db/nonAtomicMoneyFlow";

vi.mock("@/lib/bonds/bondRestructureSpend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bonds/bondRestructureSpend")>();
  // Stub only the key-only resume path: the empty-live-set tests below drive
  // the executor's delegation to it. applyBondRestructureSpend stays real so
  // the feasible-path test above still runs the keyed flow against mockDb.
  return { ...actual, resumeBondRestructureByKey: vi.fn() };
});

vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/bonds/corporateBondDefault", () => ({
  buildPrimeRateMap: vi.fn(() => new Map()),
  // Per-sector NPV: helper calls this with a single-element array.
  computeSectorNpvSum: vi.fn((sectors: { revenue: number }[]) => sectors[0]?.revenue ?? 0),
  sumDefaultedBondPrincipal: vi.fn(() => 1000),
}));
vi.mock("@/lib/corporations/restoreSectorsToUnowned", () => ({
  restoreSectorsToUnowned: vi.fn().mockResolvedValue({
    sectorsProcessed: 0,
    sectorsDeleted: 0,
    poolsUpdated: 0,
    totalRevenueRestored: 0,
  }),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/wireEvent", () => ({
  logWireEvent: vi.fn().mockResolvedValue(undefined),
  wireHeadlineCorpRestructured: vi.fn(() => "RESTRUCTURING"),
}));
vi.mock("@/lib/db/transactionSupport", () => ({
  assertTransactionSupportAtBoot: vi.fn().mockResolvedValue(false),
}));
// Era unit scale is orthogonal to restructure settlement: the real
// `loadWorldEraUnitScale` resolves the preset from gameState (absent here,
// so the modern default → scale 1) through the world-seed graph, which is
// import-heavy under vitest. Pin the leaf to its fixture value.
vi.mock("@/lib/currency/gdpAnchorRate", () => ({
  loadWorldEraUnitScale: vi.fn().mockResolvedValue(1),
}));

function makeCursor<T>(docs: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
  };
}

let db: MockDb;

describe("executeCorporationBondRestructure", () => {
  const corpId = new ObjectId();
  const charId = new ObjectId();
  const idA = new ObjectId();
  const idB = new ObjectId();
  const idC = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();

    const corp = { _id: corpId, name: "Acme", liquidCapital: 0 };
    db.collection("corporations").findOne.mockResolvedValue(corp);

    const bond = {
      _id: new ObjectId(),
      corporationId: corpId,
      couponRate: 5,
      currencyCode: undefined,
      holders: [{ characterId: charId, units: 10 }],
    };
    db.collection("bonds").find.mockReturnValue(makeCursor([bond]));
    db.collection("bonds").updateMany.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    } as never);

    // NPV by sector = revenue. Salvage = npv×0.85 → B 850, A 680, C 340.
    db.collection("corporateSectors").find.mockReturnValue(
      makeCursor([
        { _id: idA, corporationId: corpId, revenue: 800 },
        { _id: idB, corporationId: corpId, revenue: 1000 },
        { _id: idC, corporationId: corpId, revenue: 400 },
      ])
    );
    db.collection("centralBanks").find.mockReturnValue(makeCursor([]));
    db.collection("characters").find.mockReturnValue(
      makeCursor([{ _id: charId, countryId: "US", name: "Alice" }])
    );
    db.collection("exchangeRates").findOne.mockResolvedValue(null);
  });

  it("liquidates the minimum highest-value sectors and cures bonds as a restructure", async () => {
    const { executeCorporationBondRestructure } =
      await import("./executeCorporationBondRestructure");
    const { restoreSectorsToUnowned } = await import("@/lib/corporations/restoreSectorsToUnowned");

    // Explicit key so a turn/route retry converges instead of re-paying.
    const idempotencyKey = "restructure-test-key";
    const result = await executeCorporationBondRestructure(
      db as unknown as Db,
      { _id: corpId } as never,
      {
        now: new Date(),
        cureTurn: 50,
        idempotencyKey,
      }
    );

    // need = 1000 - 0 = 1000. Greedy over [B 850, A 680, C 340]: B(850) then A → 1530 ≥ 1000.
    // So sectors B and A are sold; C is kept.
    expect(restoreSectorsToUnowned).toHaveBeenCalledTimes(1);
    const liquidated = vi.mocked(restoreSectorsToUnowned).mock.calls[0]![1] as { _id: ObjectId }[];
    const liquidatedIds = liquidated.map((s) => s._id.toString()).sort();
    expect(liquidatedIds).toEqual([idA.toString(), idB.toString()].sort());

    // The keyed flow claims its idempotency receipt under the caller's key.
    const receiptInsert = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!.insertOne.mock
      .calls[0]![0] as { _id: string };
    expect(receiptInsert._id).toBe(idempotencyKey);

    // Bonds cured with the restructure cure method via a per-bond keyed cure
    // claim (guarded updateOne, never a blanket updateMany).
    expect(db.collection("bonds").updateMany).not.toHaveBeenCalled();
    const cureCall = db.collection("bonds").updateOne.mock.calls[0]!;
    expect(cureCall[0]).toMatchObject({ matured: false, defaulted: true });
    expect(
      (cureCall[1] as { $set: { defaultCure: { cureMethod: string } } }).$set.defaultCure
    ).toEqual({ cureMethod: "restructure", curedAtTurn: 50 });

    // Corp liquid capital nets +proceeds(1530) -cost(1000) = +530 through the
    // keyed corp-lc leg (guarded $inc + idempotency-key record, no bare write).
    const corpUpdate = db.collection("corporations").updateOne.mock.calls[0]!;
    expect((corpUpdate[1] as { $inc: { liquidCapital: number } }).$inc.liquidCapital).toBeCloseTo(
      530,
      6
    );
    expect(corpUpdate[1]).toHaveProperty("$push");

    // Bondholder was paid the full face (10 units x $1k) through a keyed
    // character credit (updateOne, never an unkeyed bulkWrite).
    expect(db.collection("characters").bulkWrite).not.toHaveBeenCalled();
    const charUpdate = db.collection("characters").updateOne.mock.calls[0]!;
    expect((charUpdate[0] as { _id?: ObjectId })._id?.toString()).toBe(charId.toString());
    expect((charUpdate[1] as { $inc: Record<string, number> }).$inc.cashOnHand).toBe(10_000);
    expect(charUpdate[1]).toHaveProperty("$push");

    expect(result.sectorsLiquidated).toBe(2);
    expect(result.bondsMatured).toBe(1);
    expect(result.paid).toBe(1000);
  });

  it("throws (caller falls back to dissolve) when sectors can't cover the debt", async () => {
    // Shrink every sector so total salvage < 1000.
    db.collection("corporateSectors").find.mockReturnValue(
      makeCursor([{ _id: idA, corporationId: corpId, revenue: 100 }])
    );
    const { executeCorporationBondRestructure } =
      await import("./executeCorporationBondRestructure");
    await expect(
      executeCorporationBondRestructure(db as unknown as Db, { _id: corpId } as never, {
        now: new Date(),
        cureTurn: 50,
      })
    ).rejects.toThrow(/Insufficient sector value/);
  });

  it("throws when there are no defaulted bonds", async () => {
    db.collection("bonds").find.mockReturnValue(makeCursor([]));
    const { executeCorporationBondRestructure } =
      await import("./executeCorporationBondRestructure");
    await expect(
      executeCorporationBondRestructure(db as unknown as Db, { _id: corpId } as never, {
        now: new Date(),
        cureTurn: 50,
      })
    ).rejects.toThrow(/No defaulted bonds/);
  });

  describe("empty-live-set recovery", () => {
    const storedOutcome = {
      paid: 15_000,
      bondsMatured: 2,
      sectorsLiquidated: 2,
      proceeds: 17_000,
      residualLiquidCapital: 3_000,
    };

    beforeEach(async () => {
      // The live defaulted set reads empty (every cure applied before the
      // crash), so the executor must consult the key-only resume path.
      db.collection("bonds").find.mockReturnValue(makeCursor([]));
      const { resumeBondRestructureByKey } = await import("@/lib/bonds/bondRestructureSpend");
      vi.mocked(resumeBondRestructureByKey).mockReset().mockResolvedValue(null);
    });

    async function resumeMock() {
      const { resumeBondRestructureByKey } = await import("@/lib/bonds/bondRestructureSpend");
      return vi.mocked(resumeBondRestructureByKey);
    }

    it("resumes an in-progress receipt and reports the exact stored outcome", async () => {
      const resume = await resumeMock();
      resume.mockResolvedValue({ outcome: { ...storedOutcome } });

      const { executeCorporationBondRestructure } =
        await import("./executeCorporationBondRestructure");
      const result = await executeCorporationBondRestructure(
        db as unknown as Db,
        { _id: corpId } as never,
        { now: new Date(), cureTurn: 50, idempotencyKey: "restructure-exec-resume" }
      );

      expect(resume).toHaveBeenCalledWith(db, "restructure-exec-resume", corpId);
      expect(result).toEqual({ ...storedOutcome });
    });

    it("pays no holder twice and liquidates no sector on the resume path", async () => {
      const resume = await resumeMock();
      resume.mockResolvedValue({ outcome: { ...storedOutcome } });
      const { restoreSectorsToUnowned } = await import(
        "@/lib/corporations/restoreSectorsToUnowned"
      );

      const { executeCorporationBondRestructure } =
        await import("./executeCorporationBondRestructure");
      const result = await executeCorporationBondRestructure(
        db as unknown as Db,
        { _id: corpId } as never,
        { now: new Date(), cureTurn: 50, idempotencyKey: "restructure-exec-no-duplicate" }
      );

      expect(result).toEqual({ ...storedOutcome });
      // Recovery finishes inside the primitive; the executor itself must not
      // re-liquidate, re-pay, re-cure, or move corp capital.
      expect(restoreSectorsToUnowned).not.toHaveBeenCalled();
      expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
      expect(db.collection("corporations").updateOne).not.toHaveBeenCalled();
      expect(db.collection("bonds").updateOne).not.toHaveBeenCalled();
      expect(db.collection("bonds").updateMany).not.toHaveBeenCalled();
    });

    it("keeps the historical refusal when no key is supplied", async () => {
      const { executeCorporationBondRestructure } =
        await import("./executeCorporationBondRestructure");
      await expect(
        executeCorporationBondRestructure(db as unknown as Db, { _id: corpId } as never, {
          now: new Date(),
          cureTurn: 50,
        })
      ).rejects.toThrow(/No defaulted bonds/);
      expect(await resumeMock()).not.toHaveBeenCalled();
    });

    it("keeps the historical refusal when no receipt exists under the key", async () => {
      // resumeBondRestructureByKey returns null for an absent key (primitive's
      // own "no receipt" case). The executor keeps its public refusal.
      const { executeCorporationBondRestructure } =
        await import("./executeCorporationBondRestructure");
      await expect(
        executeCorporationBondRestructure(db as unknown as Db, { _id: corpId } as never, {
          now: new Date(),
          cureTurn: 50,
          idempotencyKey: "restructure-exec-absent",
        })
      ).rejects.toThrow(/No defaulted bonds/);
      expect(db.collection("corporations").updateOne).not.toHaveBeenCalled();
    });

    it("keeps the historical refusal for a completed receipt: finished work stays historical", async () => {
      // A completed receipt is genuinely finished work, not stranded recovery:
      // the primitive returns null and the executor keeps its public refusal
      // instead of re-reporting the stored outcome.
      const { executeCorporationBondRestructure } =
        await import("./executeCorporationBondRestructure");
      await expect(
        executeCorporationBondRestructure(db as unknown as Db, { _id: corpId } as never, {
          now: new Date(),
          cureTurn: 50,
          idempotencyKey: "restructure-exec-completed",
        })
      ).rejects.toThrow(/No defaulted bonds/);
      expect(db.collection("corporations").updateOne).not.toHaveBeenCalled();
    });

    it("keeps the historical refusal for a malformed or outcome-less stored plan", async () => {
      // An in-progress receipt with no usable plan, or a stored plan whose
      // outcome is missing/malformed, cannot report an attempt: the primitive
      // returns null and the executor keeps its public refusal rather than
      // corrupt numbers.
      const { executeCorporationBondRestructure } =
        await import("./executeCorporationBondRestructure");
      await expect(
        executeCorporationBondRestructure(db as unknown as Db, { _id: corpId } as never, {
          now: new Date(),
          cureTurn: 50,
          idempotencyKey: "restructure-exec-malformed",
        })
      ).rejects.toThrow(/No defaulted bonds/);
      expect(db.collection("corporations").updateOne).not.toHaveBeenCalled();
    });

    it("propagates the terminal error for a settled failed receipt", async () => {
      const resume = await resumeMock();
      resume.mockRejectedValue(new MoneyFlowTerminalError("restructure-exec-terminal", "failed"));

      const { executeCorporationBondRestructure } =
        await import("./executeCorporationBondRestructure");
      await expect(
        executeCorporationBondRestructure(db as unknown as Db, { _id: corpId } as never, {
          now: new Date(),
          cureTurn: 50,
          idempotencyKey: "restructure-exec-terminal",
        })
      ).rejects.toBeInstanceOf(MoneyFlowTerminalError);
    });

    it("propagates the key conflict when the stored attempt names a different corporation", async () => {
      const resume = await resumeMock();
      resume.mockRejectedValue(new MoneyFlowKeyConflictError("restructure-exec-mismatch"));

      const { executeCorporationBondRestructure } =
        await import("./executeCorporationBondRestructure");
      await expect(
        executeCorporationBondRestructure(db as unknown as Db, { _id: corpId } as never, {
          now: new Date(),
          cureTurn: 50,
          idempotencyKey: "restructure-exec-mismatch",
        })
      ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
      expect(db.collection("corporations").updateOne).not.toHaveBeenCalled();
    });
  });
});
