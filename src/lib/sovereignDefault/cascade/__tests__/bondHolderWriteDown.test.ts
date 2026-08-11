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
  fxRateForCorpFromMap: vi.fn(() => 1),
  // Mocks return identity (rate=1 path) — exercise FX math via separate
  // dedicated test case below using the real helpers.
  anchorToCorpLiquidCapital: vi.fn((anchorAmount: number) => anchorAmount),
  corpCapitalToAnchor: vi.fn((localAmount: number) => localAmount),
}));

vi.mock("@/lib/currency/characterFunds", () => ({
  buildPersonalBalanceBulkOp: vi.fn((id, amount, currency, _forex) => ({
    updateOne: { filter: { _id: id }, update: { $inc: { [`bal.${currency}`]: amount } } },
  })),
}));

import { applyBondHolderWriteDowns } from "../bondHolderWriteDown";

interface FakeCorp {
  _id: ObjectId;
  liquidCurrencyCode: string;
}

function makeDb(holderCorps: FakeCorp[]) {
  const corpBulkOps: Array<Record<string, unknown>> = [];
  const charBulkOps: Array<Record<string, unknown>> = [];
  const imperialBulkOps: Array<Record<string, unknown>> = [];

  const db = {
    collection: vi.fn((name: string) => {
      if (name === "corporations") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue(holderCorps),
          }),
          bulkWrite: vi.fn().mockImplementation(async (ops) => {
            corpBulkOps.push(...ops);
            return { modifiedCount: ops.length };
          }),
        };
      }
      if (name === "characters") {
        return {
          bulkWrite: vi.fn().mockImplementation(async (ops) => {
            charBulkOps.push(...ops);
            return { modifiedCount: ops.length };
          }),
        };
      }
      if (name === "imperialCharacters") {
        return {
          bulkWrite: vi.fn().mockImplementation(async (ops) => {
            imperialBulkOps.push(...ops);
            return { modifiedCount: ops.length };
          }),
        };
      }
      throw new Error(`unexpected: ${name}`);
    }),
  } as unknown as Db;
  return { db, corpBulkOps, charBulkOps, imperialBulkOps };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("applyBondHolderWriteDowns", () => {
  it("debits corp holders' liquidCapital (via $inc with negative amount)", async () => {
    const corpId = new ObjectId();
    const bondId = new ObjectId();
    const bond: Bond = {
      _id: bondId,
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
      holders: [{ corporationId: corpId, units: 100 }],
      defaulted: true,
      defaultedAtTurn: 100,
      matured: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { db, corpBulkOps } = makeDb([{ _id: corpId, liquidCurrencyCode: "USD" } as FakeCorp]);
    const r = await applyBondHolderWriteDowns(db, [bond], 0.95, false);
    // Write-down = 100 * 1000 * 0.95 = 95_000
    expect(corpBulkOps).toHaveLength(1);
    const op = corpBulkOps[0] as { updateOne: { update: { $inc: { liquidCapital: number } } } };
    expect(op.updateOne.update.$inc.liquidCapital).toBeCloseTo(-95_000);
    expect(r.affectedCorpIds.map((id) => id.toString())).toEqual([corpId.toString()]);
  });

  it("debits character holders' personal balance with bond's currency", async () => {
    const charId = new ObjectId();
    const bond: Bond = {
      _id: new ObjectId(),
      issuerType: "sovereign",
      corporationId: new ObjectId(),
      countryId: "UK",
      currencyCode: "GBP",
      faceValue: 100_000,
      couponRate: 4,
      maturityTurns: 48,
      issuedAtTurn: 0,
      maturityTurn: 48,
      marketPrice: 0.05,
      totalIssued: 100_000,
      publicFloat: 0,
      holders: [{ characterId: charId, units: 50 }],
      defaulted: true,
      defaultedAtTurn: 100,
      matured: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { db, charBulkOps } = makeDb([]);
    const r = await applyBondHolderWriteDowns(db, [bond], 0.95, false);
    expect(charBulkOps).toHaveLength(1);
    expect(r.affectedCharacterIds.map((id) => id.toString())).toEqual([charId.toString()]);
  });

  it("aggregates totalWrittenDownAnchor across multiple bonds", async () => {
    const c1 = new ObjectId();
    const c2 = new ObjectId();
    const baseBond: Bond = {
      _id: new ObjectId(),
      issuerType: "sovereign",
      corporationId: new ObjectId(),
      countryId: "US",
      currencyCode: "USD",
      faceValue: 0,
      couponRate: 4,
      maturityTurns: 48,
      issuedAtTurn: 0,
      maturityTurn: 48,
      marketPrice: 0.05,
      totalIssued: 0,
      publicFloat: 0,
      holders: [{ corporationId: c1, units: 10 }],
      defaulted: true,
      defaultedAtTurn: 100,
      matured: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const bond2: Bond = {
      ...baseBond,
      _id: new ObjectId(),
      holders: [{ corporationId: c2, units: 20 }],
    };
    const { db } = makeDb([
      { _id: c1, liquidCurrencyCode: "USD" } as FakeCorp,
      { _id: c2, liquidCurrencyCode: "USD" } as FakeCorp,
    ]);
    const r = await applyBondHolderWriteDowns(db, [baseBond, bond2], 0.95, false);
    // (10*1000 + 20*1000) * 0.95 = 28_500
    expect(r.totalWrittenDownAnchor).toBeCloseTo(28_500);
  });

  it("zero severity short-circuits with empty report", async () => {
    const { db, corpBulkOps } = makeDb([]);
    const r = await applyBondHolderWriteDowns(db, [], 0, false);
    expect(r.totalWrittenDownAnchor).toBe(0);
    expect(corpBulkOps).toHaveLength(0);
  });

  it("cross-currency: bond_local → anchor → corp_local conversion chain is correct", async () => {
    // Regression: BOND_UNIT_FACE_VALUE × units is in the bond's LOCAL
    // currency, not anchor. Previously the code passed it directly to
    // `anchorToCorpLiquidCapital` which treats its first arg as anchor —
    // so a JPY bond debiting a USD corp got `jpy_value * usd_fx` rubbish.
    // This test mocks distinct return values for the two helpers and asserts
    // the call sequence converts through anchor.
    const { anchorToCorpLiquidCapital, corpCapitalToAnchor, fxRateForCorpFromMap } =
      await import("@/lib/currency/corporationCapital");
    vi.mocked(corpCapitalToAnchor).mockImplementation((local: number) => local / 100);
    vi.mocked(fxRateForCorpFromMap).mockReturnValue(1.0);
    vi.mocked(anchorToCorpLiquidCapital).mockImplementation((anchor: number) => anchor * 1.0);

    const corpId = new ObjectId();
    const bond: Bond = {
      _id: new ObjectId(),
      issuerType: "sovereign",
      corporationId: new ObjectId(),
      countryId: "JP",
      currencyCode: "JPY", // 100 JPY = 1 anchor (mocked)
      faceValue: 1000,
      couponRate: 4,
      maturityTurns: 48,
      issuedAtTurn: 0,
      maturityTurn: 48,
      marketPrice: 0.05,
      totalIssued: 1_000_000,
      publicFloat: 0,
      holders: [{ corporationId: corpId, units: 100 }],
      defaulted: true,
      defaultedAtTurn: 50,
      matured: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { db } = makeDb([{ _id: corpId, liquidCurrencyCode: "USD" }]);

    const r = await applyBondHolderWriteDowns(db, [bond], 0.95, true);

    // 100 units × 1000 face × 0.95 severity = 95,000 JPY (bond local)
    // ÷ 100 (JPY/anchor) = 950 anchor
    // × 1.0 (USD per anchor) = 950 USD debit
    // The intermediate writeDownAnchor should have been passed to
    // anchorToCorpLiquidCapital — verify the call args.
    const anchorCalls = vi.mocked(anchorToCorpLiquidCapital).mock.calls;
    expect(anchorCalls.length).toBe(1);
    expect(anchorCalls[0][0]).toBeCloseTo(950); // first arg = anchor amount
    expect(r.totalWrittenDownAnchor).toBeCloseTo(950);
  });

  it("legacy bond without currencyCode skips character debits silently", async () => {
    const charId = new ObjectId();
    const bond: Bond = {
      _id: new ObjectId(),
      issuerType: "sovereign",
      corporationId: new ObjectId(),
      countryId: "US",
      // currencyCode intentionally missing (legacy bond)
      faceValue: 0,
      couponRate: 4,
      maturityTurns: 48,
      issuedAtTurn: 0,
      maturityTurn: 48,
      marketPrice: 0.05,
      totalIssued: 0,
      publicFloat: 0,
      holders: [{ characterId: charId, units: 10 }],
      defaulted: true,
      defaultedAtTurn: 100,
      matured: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { db, charBulkOps } = makeDb([]);
    const r = await applyBondHolderWriteDowns(db, [bond], 0.95, false);
    expect(charBulkOps).toHaveLength(0);
    expect(r.affectedCharacterIds).toHaveLength(0);
  });
});
