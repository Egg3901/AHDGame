import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Bond } from "@/lib/db/types/bond";

vi.mock("@/lib/currency/corporationCapital", () => ({
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(
    new Map([
      ["USD", 1],
      ["GBP", 1.25],
      ["JPY", 0.007],
    ])
  ),
  // Identity: the report total is asserted in bond-local units converted
  // 1:1 here; the dedicated cross-currency case below overrides this.
  corpCapitalToAnchor: vi.fn((localAmount: number) => localAmount),
}));

import { applyBondHolderWriteDowns } from "../bondHolderWriteDown";

function makeBond(overrides: Partial<Bond> = {}): Bond {
  return {
    _id: new ObjectId(),
    issuerType: "sovereign",
    corporationId: new ObjectId(),
    countryId: "US",
    currencyCode: "USD",
    faceValue: 1_000_000,
    couponRate: 4,
    maturityTurns: 48,
    issuedAtTurn: 0,
    maturityTurn: 48,
    marketPrice: 0.05,
    totalIssued: 1_000_000,
    publicFloat: 0,
    holders: [],
    defaulted: true,
    defaultedAtTurn: 100,
    matured: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** A db stub that records every collection access — the paper-loss recorder
 *  must never touch stored balances, so any bulkWrite is a failure. */
function makeDb() {
  const bulkWrites: Array<{ collection: string; ops: unknown }> = [];
  const db = {
    collection: vi.fn((name: string) => ({
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
      bulkWrite: vi.fn().mockImplementation(async (ops: unknown) => {
        bulkWrites.push({ collection: name, ops });
        return { modifiedCount: 0 };
      }),
    })),
  } as unknown as Db;
  return { db, bulkWrites };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("applyBondHolderWriteDowns — paper loss, never a debit", () => {
  it("records corp holders in the report without debiting liquidCapital", async () => {
    const corpId = new ObjectId();
    const bond = makeBond({ holders: [{ corporationId: corpId, units: 100 }] });
    const { db, bulkWrites } = makeDb();
    const r = await applyBondHolderWriteDowns(db, [bond], 0.95);
    // Write-down = 100 * 1000 * 0.95 = 95_000 (paper)
    expect(r.totalWrittenDownAnchor).toBeCloseTo(95_000);
    expect(r.affectedCorpIds.map((id) => id.toString())).toEqual([corpId.toString()]);
    expect(bulkWrites).toHaveLength(0);
  });

  it("records character holders' paper loss with the bond's currency", async () => {
    const charId = new ObjectId();
    const bond = makeBond({
      countryId: "UK",
      currencyCode: "GBP",
      faceValue: 100_000,
      holders: [{ characterId: charId, units: 50 }],
    });
    const { db, bulkWrites } = makeDb();
    const r = await applyBondHolderWriteDowns(db, [bond], 0.95);
    // 50 * 1000 * 0.95 = 47_500 (identity FX mock)
    expect(r.totalWrittenDownAnchor).toBeCloseTo(47_500);
    expect(r.affectedCharacterIds.map((id) => id.toString())).toEqual([charId.toString()]);
    expect(bulkWrites).toHaveLength(0);
  });

  it("aggregates totalWrittenDownAnchor across multiple bonds", async () => {
    const c1 = new ObjectId();
    const c2 = new ObjectId();
    const bond1 = makeBond({ holders: [{ corporationId: c1, units: 10 }] });
    const bond2 = makeBond({
      _id: new ObjectId(),
      holders: [{ corporationId: c2, units: 20 }],
    });
    const { db } = makeDb();
    const r = await applyBondHolderWriteDowns(db, [bond1, bond2], 0.95);
    // (10*1000 + 20*1000) * 0.95 = 28_500
    expect(r.totalWrittenDownAnchor).toBeCloseTo(28_500);
  });

  it("zero severity short-circuits with empty report", async () => {
    const { db, bulkWrites } = makeDb();
    const r = await applyBondHolderWriteDowns(db, [], 0);
    expect(r.totalWrittenDownAnchor).toBe(0);
    expect(bulkWrites).toHaveLength(0);
  });

  it("cross-currency: report total converts bond-local → anchor", async () => {
    // BOND_UNIT_FACE_VALUE × units is in the bond's LOCAL currency, not
    // anchor: a JPY holding must be scaled through the bond FX rate before
    // it lands in totalWrittenDownAnchor.
    const { corpCapitalToAnchor } = await import("@/lib/currency/corporationCapital");
    vi.mocked(corpCapitalToAnchor).mockImplementation((local: number) => local / 100);

    const corpId = new ObjectId();
    const bond = makeBond({
      countryId: "JP",
      currencyCode: "JPY", // 100 JPY = 1 anchor (mocked)
      faceValue: 1000,
      defaultedAtTurn: 50,
      holders: [{ corporationId: corpId, units: 100 }],
    });
    const { db, bulkWrites } = makeDb();

    const r = await applyBondHolderWriteDowns(db, [bond], 0.95);

    // 100 units × 1000 face × 0.95 severity = 95,000 JPY (bond local)
    // ÷ 100 (JPY/anchor) = 950 anchor
    expect(r.totalWrittenDownAnchor).toBeCloseTo(950);
    expect(r.affectedCorpIds.map((id) => id.toString())).toEqual([corpId.toString()]);
    expect(bulkWrites).toHaveLength(0);
  });

  it("legacy bond without currencyCode skips character ids silently", async () => {
    const charId = new ObjectId();
    const bond = makeBond({
      currencyCode: undefined,
      holders: [{ characterId: charId, units: 10 }],
    });
    const { db, bulkWrites } = makeDb();
    const r = await applyBondHolderWriteDowns(db, [bond], 0.95);
    expect(r.affectedCharacterIds).toHaveLength(0);
    expect(bulkWrites).toHaveLength(0);
  });
});
