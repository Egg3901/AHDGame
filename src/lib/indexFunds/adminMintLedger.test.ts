import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";

vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn().mockResolvedValue(undefined) }));

import { emitTx } from "@/lib/financialTxLog/emit";
import { emitFundAdminMintLeg } from "./adminMintLedger";

const db = {} as Db;
const base = {
  fundId: new ObjectId(),
  fundName: "US 25 Index",
  fundSlug: "us25",
  currencyCode: "USD" as const,
  adminName: "Site Admin",
  turn: 42,
  tool: "inject_capital_all",
};

describe("emitFundAdminMintLeg", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks an admin injection as an attributable mint", async () => {
    await emitFundAdminMintLeg(db, { ...base, amountAnchor: 50_000_000 });

    const leg = vi.mocked(emitTx).mock.calls[0][1];
    expect(leg.amount).toBe(50_000_000);
    // Stated outright: the ₳ figure is the injection, not something to re-derive.
    expect(leg.anchorAmount).toBe(50_000_000);
    expect(leg.counterpartyType).toBe("system");
    expect(leg.meta).toMatchObject({
      kind: "index_fund_capital_injection",
      mint: true,
      tool: "inject_capital_all",
      adminName: "Site Admin",
    });
  });

  it("emits nothing for a non-positive or non-finite amount", async () => {
    await emitFundAdminMintLeg(db, { ...base, amountAnchor: 0 });
    await emitFundAdminMintLeg(db, { ...base, amountAnchor: -5 });
    await emitFundAdminMintLeg(db, { ...base, amountAnchor: Number.NaN });
    expect(emitTx).not.toHaveBeenCalled();
  });
});
