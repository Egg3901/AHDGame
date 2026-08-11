/**
 * Regression tests for POST /api/corporations/[id]/bond-default/refinance —
 * specifically the financial-ledger emission.
 *
 * Refinance is a debt-for-debt swap: defaulted-bond holders are migrated to
 * a freshly-issued bond at par, and zero cash actually changes hands. So the
 * emitted row uses amount=0 (truthful about cash flow) but still records the
 * event with the new bond's principal in `meta.faceValue`. Without this row,
 * "show me all bond-issuance events on turn N" is silently incomplete.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/wireEvent", () => ({
  logWireEvent: vi.fn(),
  wireHeadlineBond: vi.fn().mockReturnValue("Bond issued"),
}));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 444 }),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
  emitTxBulk: vi.fn().mockResolvedValue(undefined),
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));

let db: MockDb;

beforeEach(async () => {
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
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString() },
  } as never);
  const { checkRateLimit } = await import("@/lib/api/rateLimit");
  vi.mocked(checkRateLimit).mockReturnValue({
    ok: true,
    limit: 100,
    remaining: 99,
    resetAt: Date.now() + 60_000,
  });
  const { requireCeo } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(requireCeo).mockReturnValue(null);
});

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("POST /api/corporations/[id]/bond-default/refinance — ledger emission", () => {
  it("emits a cashless bond_issuance tx for the new refinance bond", async () => {
    const corpId = new ObjectId();
    const charId = new ObjectId();
    const newBondInsertId = new ObjectId();

    const corporation = {
      _id: corpId,
      name: "Refi Corp",
      countryId: "US",
      liquidCapital: 100_000_000,
      liquidCurrencyCode: "USD",
      bondDefaultRefinanceCount: 0,
      sequentialId: 99,
    };

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation,
    } as never);

    const defaultedBond = {
      _id: new ObjectId(),
      corporationId: corpId,
      currencyCode: "USD",
      matured: false,
      defaulted: true,
      couponRate: 8,
      totalIssued: 10_000_000,
      holders: [{ characterId: charId, units: 10_000 }],
      publicFloat: 0,
    };

    // Both `find` calls (defaulted bonds + all non-matured) return the same
    // single defaulted bond in this fixture.
    db.collectionMocks["bonds"]!.find.mockImplementation(() => makeCursor([defaultedBond]));
    db.collectionMocks["bonds"]!.insertOne.mockResolvedValue({ insertedId: newBondInsertId });

    db.collectionMocks["corporateSectors"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["centralBanks"]!.find.mockReturnValue(
      makeCursor([{ countryId: "US", primeRate: 5 }])
    );
    db.collectionMocks["exchangeRates"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["corporationHistory"]!.findOne.mockResolvedValue({
      income: 1_000_000,
    });

    const req = new Request(
      `http://localhost/api/corporations/${corpId.toString()}/bond-default/refinance`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maturityTurns: 96 }),
      }
    );
    const { POST } = await import("./route");
    const res = await POST(req, { params: Promise.resolve({ id: corpId.toString() }) });
    expect(res.status).toBe(200);

    const { emitTx } = await import("@/lib/financialTxLog/emit");
    expect(vi.mocked(emitTx)).toHaveBeenCalled();
    const issuanceCall = vi
      .mocked(emitTx)
      .mock.calls.find(([, entry]) => (entry as { type?: string }).type === "bond_issuance");
    expect(issuanceCall).toBeDefined();
    const entry = issuanceCall![1] as {
      type: string;
      subjectType: string;
      subjectId: ObjectId;
      subjectName: string;
      amount: number;
      currencyCode: string;
      meta?: { bondId?: string; refinance?: boolean; faceValue?: number };
    };
    expect(entry.subjectType).toBe("corporation");
    expect(entry.subjectId.toString()).toBe(corpId.toString());
    expect(entry.subjectName).toBe("Refi Corp");
    // Cash flow is zero — debt-for-debt swap, no investors paid in.
    expect(entry.amount).toBe(0);
    expect(entry.meta?.refinance).toBe(true);
    expect(entry.meta?.bondId).toBe(newBondInsertId.toString());
    expect(entry.meta?.faceValue).toBeGreaterThan(0);

    // Retired bonds are flipped to matured + defaulted=false but their
    // defaultedAtTurn is preserved and a defaultCure marker is stamped so
    // the Bonds tab can render "DEFAULT CURED (T<x> → refinance)".
    const oldBondsUpdateCall = db.collectionMocks["bonds"]!.updateMany.mock.calls[0];
    expect(oldBondsUpdateCall).toBeDefined();
    const oldBondsUpdate = oldBondsUpdateCall![1] as {
      $set: {
        matured?: boolean;
        defaulted?: boolean;
        defaultCure?: { cureMethod?: string; curedAtTurn?: number };
      };
      $unset?: Record<string, string>;
    };
    expect(oldBondsUpdate.$set.matured).toBe(true);
    expect(oldBondsUpdate.$set.defaulted).toBe(false);
    expect(oldBondsUpdate.$set.defaultCure?.cureMethod).toBe("refinance");
    expect(oldBondsUpdate.$set.defaultCure?.curedAtTurn).toBe(444);
    expect(oldBondsUpdate.$unset?.defaultedAtTurn).toBeUndefined();
  });
});
