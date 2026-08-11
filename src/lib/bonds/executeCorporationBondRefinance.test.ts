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

vi.mock("@/lib/wireEvent", () => ({
  logWireEvent: vi.fn(),
  wireHeadlineBond: vi.fn().mockReturnValue("Bond issued"),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
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
    const newBondId = new ObjectId();
    db.collectionMocks["bonds"]!.find.mockImplementation(() => makeCursor([bond]));
    db.collectionMocks["bonds"]!.insertOne.mockResolvedValue({ insertedId: newBondId });

    const { executeCorporationBondRefinance } = await import("./executeCorporationBondRefinance");
    const result = await executeCorporationBondRefinance(db as unknown as Db, baseCorp() as never, {
      now: new Date(),
      currentTurn: 444,
      maturityTurns: 96,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.bondId).toBe(newBondId.toString());
    expect(result.bondsMatured).toBe(1);
    expect(result.maturityTurn).toBe(444 + 96);

    // A single fresh, non-defaulted bond is inserted with the defaulted holders rolled in.
    const insertCall = db.collectionMocks["bonds"]!.insertOne.mock.calls[0]!;
    const newDoc = insertCall[0] as {
      defaulted: boolean;
      matured: boolean;
      holders: { characterId?: ObjectId; units: number }[];
      totalIssued: number;
    };
    expect(newDoc.defaulted).toBe(false);
    expect(newDoc.matured).toBe(false);
    expect(newDoc.holders).toHaveLength(1);
    expect(newDoc.holders[0]!.units).toBe(10_000);
    expect(newDoc.totalIssued).toBe(10_000 * 1_000);

    // Old bonds are matured + cured via the refinance cure method.
    const updateManyCall = db.collectionMocks["bonds"]!.updateMany.mock.calls[0]!;
    const set = (updateManyCall[1] as { $set: Record<string, unknown> }).$set;
    expect(set.matured).toBe(true);
    expect(set.defaulted).toBe(false);
    expect((set.defaultCure as { cureMethod: string }).cureMethod).toBe("refinance");

    // Corp refinance count incremented; liquidCapital is NEVER touched (cashless swap).
    const corpUpdate = db.collectionMocks["corporations"]!.updateOne.mock.calls[0]!;
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
