/**
 * Tests for executeCorporationBondRefinance — the shared refinance core used by
 * both the CEO-initiated HTTP route and the turn-tick auto-resolver.
 *
 * Refinance is a debt-for-debt swap: defaulted-bond holders roll into a fresh
 * bond at par, NO cash changes hands, NO sectors are sold. These tests cover the
 * feasible path plus the two infeasibility gates (leverage cap + lifetime
 * refinance cap).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { MAX_BOND_DEFAULT_REFINANCES } from "@/lib/constants/bonds";
import {
  keyedInsertId,
  MoneyFlowKeyConflictError,
  MoneyFlowTerminalError,
} from "@/lib/db/nonAtomicMoneyFlow";

vi.mock("@/lib/bonds/bondRefinanceSpend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bonds/bondRefinanceSpend")>();
  // Stub only the key-only resume path: the empty-live-set tests below drive
  // the executor's delegation to it. applyBondRefinanceSpend stays real so the
  // feasible-path tests above still run the keyed flow against mockDb.
  return { ...actual, resumeBondRefinanceByKey: vi.fn() };
});

vi.mock("@/lib/wireEvent", () => ({
  logWireEvent: vi.fn(),
  wireHeadlineBond: vi.fn().mockReturnValue("Bond issued"),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/db/transactionSupport", () => ({
  assertTransactionSupportAtBoot: vi.fn().mockResolvedValue(false),
}));

function makeCursor<T>(docs: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
  };
}

let db: MockDb;

const corpId = new ObjectId();
const charId = new ObjectId();

function baseCorp(overrides: Record<string, unknown> = {}) {
  return {
    _id: corpId,
    name: "Refi Corp",
    countryId: "US",
    liquidCapital: 100_000_000,
    liquidCurrencyCode: "USD",
    bondDefaultRefinanceCount: 0,
    sequentialId: 42,
    ...overrides,
  };
}

function defaultedBond(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    corporationId: corpId,
    currencyCode: "USD",
    matured: false,
    defaulted: true,
    couponRate: 8,
    maturityTurns: 96,
    totalIssued: 10_000_000,
    holders: [{ characterId: charId, units: 10_000 }],
    publicFloat: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  for (const name of [
    "bonds",
    "corporations",
    "corporateSectors",
    "centralBanks",
    "corporationHistory",
    "exchangeRates",
  ]) {
    db.collection(name);
  }
  db.collectionMocks["corporateSectors"]!.find.mockReturnValue(makeCursor([]));
  db.collectionMocks["centralBanks"]!.find.mockReturnValue(
    makeCursor([{ countryId: "US", primeRate: 5 }])
  );
  db.collectionMocks["exchangeRates"]!.find.mockReturnValue(makeCursor([]));
  db.collectionMocks["exchangeRates"]!.findOne.mockResolvedValue(null);
  db.collectionMocks["corporationHistory"]!.findOne.mockResolvedValue({ income: 1_000_000 });
});

describe("executeCorporationBondRefinance", () => {
  it("refinances a feasible corp into a new bond without selling sectors or moving cash", async () => {
    const bond = defaultedBond();
    db.collectionMocks["bonds"]!.find.mockImplementation(() => makeCursor([bond]));

    // Explicit key so the replacement-bond id is deterministic
    // (keyedInsertId), not a minted random id.
    const idempotencyKey = "refi-test-key";
    const expectedBondId = keyedInsertId(idempotencyKey, "bond-refinance").toHexString();

    const { executeCorporationBondRefinance } = await import("./executeCorporationBondRefinance");
    const result = await executeCorporationBondRefinance(db as unknown as Db, baseCorp() as never, {
      now: new Date(),
      currentTurn: 444,
      maturityTurns: 96,
      idempotencyKey,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bondId).toBe(expectedBondId);
    expect(result.bondsMatured).toBe(1);
    expect(result.maturityTurn).toBe(444 + 96);

    // The keyed flow claims its idempotency receipt under the caller's key.
    const receiptInsert = db.collectionMocks["nonAtomicMoneyFlowReceipts"]!.insertOne.mock
      .calls[0]![0] as { _id: string };
    expect(receiptInsert._id).toBe(idempotencyKey);

    // A single fresh, non-defaulted bond is inserted with the defaulted holders rolled in,
    // carrying the deterministic key-derived _id (a retry converges, never double-issues).
    const insertCall = db.collectionMocks["bonds"]!.insertOne.mock.calls[0]!;
    const newDoc = insertCall[0] as {
      _id: ObjectId;
      defaulted: boolean;
      matured: boolean;
      holders: { characterId?: ObjectId; units: number }[];
      totalIssued: number;
    };
    expect(newDoc._id.toHexString()).toBe(expectedBondId);
    expect(newDoc.defaulted).toBe(false);
    expect(newDoc.matured).toBe(false);
    expect(newDoc.holders).toHaveLength(1);
    expect(newDoc.holders[0]!.units).toBe(10_000);
    expect(newDoc.totalIssued).toBe(10_000 * 1_000);

    // The old bond is matured + cured via a per-bond keyed cure claim
    // (guarded updateOne, never a blanket updateMany).
    expect(db.collectionMocks["bonds"]!.updateMany).not.toHaveBeenCalled();
    const cureCall = db.collectionMocks["bonds"]!.updateOne.mock.calls.find(
      (call) =>
        (call[0] as { _id?: ObjectId })._id?.toString() === bond._id.toString()
    )!;
    expect(cureCall).toBeDefined();
    expect(cureCall[0]).toMatchObject({
      _id: bond._id,
      corporationId: corpId,
      matured: false,
      defaulted: true,
    });
    const set = (cureCall[1] as { $set: Record<string, unknown> }).$set;
    expect(set.matured).toBe(true);
    expect(set.defaulted).toBe(false);
    expect((set.defaultCure as { cureMethod: string }).cureMethod).toBe("refinance");

    // Corp refinance count claimed through the guarded count step (lifetime
    // cap enforced inside the claim); liquidCapital is NEVER touched (cashless swap).
    const corpUpdate = db.collectionMocks["corporations"]!.updateOne.mock.calls[0]!;
    const filter = corpUpdate[0] as { _id?: ObjectId; $or?: unknown };
    expect(filter._id?.toString()).toBe(corpId.toString());
    expect(filter.$or).toBeDefined();
    const update = corpUpdate[1] as {
      $inc?: Record<string, unknown>;
      $set?: Record<string, unknown>;
    };
    expect(update.$inc?.bondDefaultRefinanceCount).toBe(1);
    expect(update.$inc?.liquidCapital).toBeUndefined();
    expect(update.$set?.liquidCapital).toBeUndefined();

    // No sectors touched — restructure path (corporateSectors deletes/updates) never runs here.
    expect(db.collectionMocks["corporateSectors"]!.deleteMany).not.toHaveBeenCalled();
    expect(db.collectionMocks["corporateSectors"]!.updateMany).not.toHaveBeenCalled();
  });

  it("returns {ok:false} for an over-leveraged corp (defaulted principal exceeds 2× equity)", async () => {
    const bond = defaultedBond();
    db.collectionMocks["bonds"]!.find.mockImplementation(() => makeCursor([bond]));

    const { executeCorporationBondRefinance } = await import("./executeCorporationBondRefinance");
    // liquidCapital tiny + no sectors → equity ≪ defaulted principal → cannot refinance.
    const result = await executeCorporationBondRefinance(
      db as unknown as Db,
      baseCorp({ liquidCapital: 1_000_000 }) as never,
      { now: new Date(), currentTurn: 444, maturityTurns: 96 }
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not ok");
    expect(result.reason).toMatch(/debt limits/i);
    expect(db.collectionMocks["bonds"]!.insertOne).not.toHaveBeenCalled();
  });

  it("returns {ok:false} when the lifetime refinance cap is reached", async () => {
    const bond = defaultedBond();
    db.collectionMocks["bonds"]!.find.mockImplementation(() => makeCursor([bond]));

    const { executeCorporationBondRefinance } = await import("./executeCorporationBondRefinance");
    const result = await executeCorporationBondRefinance(
      db as unknown as Db,
      baseCorp({ bondDefaultRefinanceCount: MAX_BOND_DEFAULT_REFINANCES }) as never,
      { now: new Date(), currentTurn: 444, maturityTurns: 96 }
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not ok");
    expect(result.reason).toMatch(/limit reached/i);
    expect(db.collectionMocks["bonds"]!.insertOne).not.toHaveBeenCalled();
  });
});

describe("executeCorporationBondRefinance empty-live-set recovery", () => {
  const storedOutcome = {
    faceValueAnchor: 15_000_000,
    couponRate: 7.5,
    maturityTurn: 540,
    bondsMatured: 2,
    retiredBondIds: [new ObjectId().toHexString(), new ObjectId().toHexString()],
  };
  const storedBondId = new ObjectId().toHexString();

  beforeEach(async () => {
    // The live defaulted set reads empty (every cure applied before the
    // crash), so the executor must consult the key-only resume path.
    db.collectionMocks["bonds"]!.find.mockImplementation(() => makeCursor([]));
    const { resumeBondRefinanceByKey } = await import("@/lib/bonds/bondRefinanceSpend");
    vi.mocked(resumeBondRefinanceByKey).mockReset().mockResolvedValue(null);
  });

  async function resumeMock() {
    const { resumeBondRefinanceByKey } = await import("@/lib/bonds/bondRefinanceSpend");
    return vi.mocked(resumeBondRefinanceByKey);
  }

  it("resumes an in-progress receipt and reports the exact stored outcome", async () => {
    const resume = await resumeMock();
    resume.mockResolvedValue({
      bondId: storedBondId,
      outcome: { ...storedOutcome, retiredBondIds: [...storedOutcome.retiredBondIds] },
    });

    const { executeCorporationBondRefinance } = await import("./executeCorporationBondRefinance");
    const result = await executeCorporationBondRefinance(db as unknown as Db, baseCorp() as never, {
      now: new Date(),
      currentTurn: 444,
      maturityTurns: 96,
      idempotencyKey: "refi-exec-resume",
    });

    expect(resume).toHaveBeenCalledWith(db, "refi-exec-resume", corpId);
    expect(result).toEqual({ ok: true, bondId: storedBondId, ...storedOutcome });
  });

  it("issues no replacement bond and touches no corp state on the resume path", async () => {
    const resume = await resumeMock();
    resume.mockResolvedValue({
      bondId: storedBondId,
      outcome: { ...storedOutcome, retiredBondIds: [...storedOutcome.retiredBondIds] },
    });

    const { executeCorporationBondRefinance } = await import("./executeCorporationBondRefinance");
    const result = await executeCorporationBondRefinance(db as unknown as Db, baseCorp() as never, {
      now: new Date(),
      currentTurn: 444,
      maturityTurns: 96,
      idempotencyKey: "refi-exec-no-duplicate",
    });

    expect(result.ok).toBe(true);
    // Recovery finishes inside the primitive; the executor itself must not
    // issue a second replacement, re-cure, or re-count.
    expect(db.collectionMocks["bonds"]!.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["bonds"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["bonds"]!.updateMany).not.toHaveBeenCalled();
    expect(db.collectionMocks["corporations"]!.updateOne).not.toHaveBeenCalled();
  });

  it("keeps the historical no-default result when no key is supplied", async () => {
    const { executeCorporationBondRefinance } = await import("./executeCorporationBondRefinance");
    const result = await executeCorporationBondRefinance(db as unknown as Db, baseCorp() as never, {
      now: new Date(),
      currentTurn: 444,
      maturityTurns: 96,
    });

    expect(result).toEqual({ ok: false, reason: "No defaulted bonds to refinance" });
    expect(await resumeMock()).not.toHaveBeenCalled();
  });

  it("keeps the historical result when no receipt exists under the key", async () => {
    // resumeBondRefinanceByKey returns null for an absent key (primitive's
    // own "no receipt" case). The executor keeps its public result.
    const { executeCorporationBondRefinance } = await import("./executeCorporationBondRefinance");
    const result = await executeCorporationBondRefinance(db as unknown as Db, baseCorp() as never, {
      now: new Date(),
      currentTurn: 444,
      maturityTurns: 96,
      idempotencyKey: "refi-exec-absent",
    });

    expect(result).toEqual({ ok: false, reason: "No defaulted bonds to refinance" });
    expect(db.collectionMocks["bonds"]!.insertOne).not.toHaveBeenCalled();
  });

  it("keeps the historical result for a completed receipt: finished work stays historical", async () => {
    // A completed receipt is genuinely finished work, not stranded recovery:
    // the primitive returns null and the executor keeps its public result
    // instead of re-reporting the stored outcome.
    const { executeCorporationBondRefinance } = await import("./executeCorporationBondRefinance");
    const result = await executeCorporationBondRefinance(db as unknown as Db, baseCorp() as never, {
      now: new Date(),
      currentTurn: 444,
      maturityTurns: 96,
      idempotencyKey: "refi-exec-completed",
    });

    expect(result).toEqual({ ok: false, reason: "No defaulted bonds to refinance" });
    expect(db.collectionMocks["bonds"]!.insertOne).not.toHaveBeenCalled();
  });

  it("keeps the historical result for a malformed or outcome-less stored plan", async () => {
    // An in-progress receipt with no usable plan, or a stored plan whose
    // outcome is missing/malformed, cannot report an attempt: the primitive
    // returns null and the executor keeps its public result rather than
    // corrupt numbers.
    const { executeCorporationBondRefinance } = await import("./executeCorporationBondRefinance");
    const result = await executeCorporationBondRefinance(db as unknown as Db, baseCorp() as never, {
      now: new Date(),
      currentTurn: 444,
      maturityTurns: 96,
      idempotencyKey: "refi-exec-malformed",
    });

    expect(result).toEqual({ ok: false, reason: "No defaulted bonds to refinance" });
    expect(db.collectionMocks["bonds"]!.insertOne).not.toHaveBeenCalled();
  });

  it("propagates the terminal error for a settled failed receipt", async () => {
    const resume = await resumeMock();
    resume.mockRejectedValue(new MoneyFlowTerminalError("refi-exec-terminal", "failed"));

    const { executeCorporationBondRefinance } = await import("./executeCorporationBondRefinance");
    await expect(
      executeCorporationBondRefinance(db as unknown as Db, baseCorp() as never, {
        now: new Date(),
        currentTurn: 444,
        maturityTurns: 96,
        idempotencyKey: "refi-exec-terminal",
      })
    ).rejects.toBeInstanceOf(MoneyFlowTerminalError);
  });

  it("propagates the key conflict when the stored attempt names a different corporation", async () => {
    const resume = await resumeMock();
    resume.mockRejectedValue(new MoneyFlowKeyConflictError("refi-exec-mismatch"));

    const { executeCorporationBondRefinance } = await import("./executeCorporationBondRefinance");
    await expect(
      executeCorporationBondRefinance(db as unknown as Db, baseCorp() as never, {
        now: new Date(),
        currentTurn: 444,
        maturityTurns: 96,
        idempotencyKey: "refi-exec-mismatch",
      })
    ).rejects.toBeInstanceOf(MoneyFlowKeyConflictError);
    expect(db.collectionMocks["bonds"]!.insertOne).not.toHaveBeenCalled();
  });
});
