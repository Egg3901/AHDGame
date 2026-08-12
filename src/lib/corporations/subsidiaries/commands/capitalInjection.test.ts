import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";

vi.mock("../authorization", () => ({ canActOnCorporationAsParent: vi.fn() }));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/financialTxLog/atomicCashGuard", () => ({
  atomicallyDebitCorpLiquidCapital: vi.fn().mockResolvedValue({ ok: true, newBalance: 0 }),
  creditCorpLiquidCapital: vi.fn().mockResolvedValue(1),
  refundCorpLiquidCapital: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  anchorToCorpLiquidCapital: (a: number) => a,
  corpLiquidCapitalToAnchor: (a: number) => a,
  getCorpFxRate: vi.fn().mockResolvedValue(1),
  resolveCorpLiquidCurrencyCode: () => "USD",
}));

import { canActOnCorporationAsParent } from "../authorization";
import { emitTx } from "@/lib/financialTxLog/emit";
import {
  atomicallyDebitCorpLiquidCapital,
  creditCorpLiquidCapital,
  refundCorpLiquidCapital,
} from "@/lib/financialTxLog/atomicCashGuard";
import { capitalInjection } from "./capitalInjection";
import { SUBSIDIARY_CAPITAL_INJECTION_COOLDOWN_TURNS } from "../constants";

const parentId = new ObjectId();
const subId = new ObjectId();
const callerUserId = new ObjectId();

function sub(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: subId,
    name: "Sub Co",
    totalShares: 100,
    shareholders: [{ corporationId: parentId, shares: 100 }],
    liquidCapital: 0,
    ...overrides,
  } as unknown as Corporation;
}

function makeDb(parentLiquid = 100_000_000) {
  const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  return {
    db: {
      collection: vi.fn(() => ({
        findOne: vi.fn().mockResolvedValue({
          _id: parentId,
          name: "Parent Co",
          liquidCapital: parentLiquid,
          liquidCurrencyCode: "USD",
        }),
        updateOne,
      })),
    } as unknown as Db,
    updateOne,
  };
}

const base = { callerUserId, turn: 1000, now: new Date() };

describe("capitalInjection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(canActOnCorporationAsParent).mockResolvedValue(true);
  });

  it("refuses a caller who is not the parent's CEO, moving no money", async () => {
    vi.mocked(canActOnCorporationAsParent).mockResolvedValue(false);
    const { db } = makeDb();

    const result = await capitalInjection(db, { sub: sub(), amount: 1_000, ...base });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
    expect(atomicallyDebitCorpLiquidCapital).not.toHaveBeenCalled();
  });

  it("caps one injection at 25% of parent liquid capital", async () => {
    const { db } = makeDb(1_000);

    const result = await capitalInjection(db, { sub: sub(), amount: 251, ...base });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/25%/);
    expect(atomicallyDebitCorpLiquidCapital).not.toHaveBeenCalled();
  });

  it("enforces the per-subsidiary cooldown", async () => {
    const { db } = makeDb();
    const recent = sub({ lastCapitalInjectionTurn: 1000 - 1 } as Partial<Corporation>);

    const result = await capitalInjection(db, { sub: recent, amount: 1_000, ...base });

    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toContain(String(SUBSIDIARY_CAPITAL_INJECTION_COOLDOWN_TURNS - 1));
    expect(atomicallyDebitCorpLiquidCapital).not.toHaveBeenCalled();
  });

  it("moves the money once and ledgers both legs", async () => {
    const { db } = makeDb();

    const result = await capitalInjection(db, { sub: sub(), amount: 1_000, ...base });

    expect(result.ok).toBe(true);
    expect(atomicallyDebitCorpLiquidCapital).toHaveBeenCalledWith(db, parentId, 1_000);
    expect(creditCorpLiquidCapital).toHaveBeenCalledWith(db, subId, 1_000);
    // Paired legs that net to zero: this is a transfer, not creation.
    const legs = vi.mocked(emitTx).mock.calls.map((c) => c[1]);
    expect(legs).toHaveLength(2);
    expect(legs.reduce((sum, l) => sum + l.amount, 0)).toBe(0);
  });

  it("refunds the parent when the subsidiary credit fails", async () => {
    vi.mocked(creditCorpLiquidCapital).mockResolvedValueOnce(null);
    const { db } = makeDb();

    const result = await capitalInjection(db, { sub: sub(), amount: 1_000, ...base });

    expect(result.ok).toBe(false);
    expect(refundCorpLiquidCapital).toHaveBeenCalledWith(db, parentId, 1_000);
  });
});
