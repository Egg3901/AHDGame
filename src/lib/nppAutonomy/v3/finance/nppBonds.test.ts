import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { BOND_BUY_FUNDS, BOND_BUY_RESERVE } from "@/lib/bonds/bondBuySpend";

vi.mock("@/lib/bonds/bondBuySpend", () => ({
  applyBondBuySpend: vi.fn(),
  BOND_BUY_FUNDS: "BOND_BUY_FUNDS",
  BOND_BUY_RESERVE: "BOND_BUY_RESERVE",
  BOND_BUY_POOL: "BOND_BUY_POOL",
  BOND_BUY_SPREAD: "BOND_BUY_SPREAD",
}));
vi.mock("@/lib/bonds/marketPool", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bonds/marketPool")>();
  return {
    ...actual,
    loadBondQuote: vi.fn().mockResolvedValue({ askPerUnit: 950 }),
  };
});
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn().mockResolvedValue(undefined) }));
import { applyBondBuySpend } from "@/lib/bonds/bondBuySpend";
import { emitTx } from "@/lib/financialTxLog/emit";
import { nppBuyBond } from "./nppBonds";

describe("nppBuyBond", () => {
  const nppId = new ObjectId();
  const bondId = new ObjectId();
  const npp = { _id: nppId, countryId: "US" as const };
  const MARKET = 0.95;
  const UNITS = 10;
  const EXPECTED_COST = Math.round(UNITS * BOND_UNIT_FACE_VALUE * MARKET * 100) / 100;

  let bondsFindOne: ReturnType<typeof vi.fn>;
  let nppsFindOne: ReturnType<typeof vi.fn>;
  let db: Db;

  beforeEach(() => {
    vi.clearAllMocks();
    bondsFindOne = vi.fn().mockResolvedValue({
      _id: bondId,
      marketPrice: MARKET,
      publicFloat: 1000,
      maturityTurn: 100,
      currencyCode: "USD",
    });
    // Post-commit balance re-read (the keyed flow reports no newBalance).
    nppsFindOne = vi.fn().mockResolvedValue({ _id: nppId, nppInvestmentCashAnchor: 500_000 });
    db = {
      collection: (name: string) =>
        name === "bonds"
          ? { findOne: bondsFindOne }
          : name === "npps"
            ? { findOne: nppsFindOne }
            : {},
    } as unknown as Db;
    vi.mocked(applyBondBuySpend).mockResolvedValue({ duplicate: false });
  });

  it("buys units through one keyed flow keyed to the nppId holder", async () => {
    const res = await nppBuyBond(db, npp, bondId, UNITS, 4, 1);

    expect(res).toEqual({
      ok: true,
      bondId: bondId.toString(),
      units: UNITS,
      cost: EXPECTED_COST,
      costAnchor: EXPECTED_COST, // homeRate=1 → anchor == local
      investmentCashAnchor: 500_000,
    });
    // Investment account debited with a guard (NOT campaign funds), holder
    // reserved to the nppId variant with avg cost, pool credited in the
    // bond's currency — one flow, one fingerprint.
    expect(applyBondBuySpend).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        bondId,
        buyerKind: "npp",
        buyerId: nppId,
        units: UNITS,
        debitAmount: EXPECTED_COST,
        costLocal: EXPECTED_COST,
        bondCurrency: "USD",
        avgCostPerUnit: 950,
        fingerprint: `bond-buy:${bondId.toHexString()}:npp:${nppId.toHexString()}:${UNITS}:${EXPECTED_COST}`,
      })
    );
    expect(emitTx).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        type: "bond_purchase",
        subjectType: "npp",
        subjectId: nppId,
        amount: -EXPECTED_COST,
        anchorAmount: -EXPECTED_COST,
        currencyCode: "USD",
      })
    );
  });

  it("maps a lost funds race to insufficient capital", async () => {
    vi.mocked(applyBondBuySpend).mockRejectedValue(new Error(`${BOND_BUY_FUNDS}:guard-rejected`));

    const res = await nppBuyBond(db, npp, bondId, UNITS, 4, 1);

    expect(res).toEqual({
      ok: false,
      reason: "Insufficient investment capital for bond purchase.",
    });
    expect(emitTx).not.toHaveBeenCalled();
  });

  it("maps a lost float race to the refunded reason", async () => {
    vi.mocked(applyBondBuySpend).mockRejectedValue(new Error(`${BOND_BUY_RESERVE}:guard-rejected`));

    const res = await nppBuyBond(db, npp, bondId, UNITS, 4, 1);

    expect(res).toEqual({
      ok: false,
      reason: "Bond units no longer available; purchase refunded.",
    });
    expect(emitTx).not.toHaveBeenCalled();
  });

  it("keeps non-unit RU/SUR local and anchor amounts distinct", async () => {
    const ruNppId = new ObjectId();
    const ruBondId = new ObjectId();
    bondsFindOne.mockResolvedValue({
      _id: ruBondId,
      marketPrice: MARKET,
      publicFloat: 1000,
      maturityTurn: 100,
      currencyCode: "SUR",
    });
    nppsFindOne.mockResolvedValue({ _id: ruNppId, nppInvestmentCashAnchor: 10_000 });

    const result = await nppBuyBond(db, { _id: ruNppId, countryId: "RU" }, ruBondId, UNITS, 4, 9);

    const expectedAnchorCost = Math.round((EXPECTED_COST / 9) * 100) / 100;
    expect(result).toMatchObject({ ok: true, cost: EXPECTED_COST, costAnchor: expectedAnchorCost });
    expect(applyBondBuySpend).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ debitAmount: expectedAnchorCost, costLocal: EXPECTED_COST })
    );
    expect(emitTx).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        subjectType: "npp",
        amount: -EXPECTED_COST,
        currencyCode: "SUR",
        anchorAmount: -expectedAnchorCost,
        balanceAfter: 10_000 * 9,
      })
    );
  });

  it("rejects bonds outside the NPP's home currency (no FX)", async () => {
    bondsFindOne.mockResolvedValue({
      _id: bondId,
      marketPrice: MARKET,
      publicFloat: 1000,
      maturityTurn: 100,
      currencyCode: "GBP",
    });
    const res = await nppBuyBond(db, npp, bondId, UNITS, 4, 1);
    expect(res).toEqual({ ok: false, reason: "NPPs only buy bonds in their home currency." });
    expect(applyBondBuySpend).not.toHaveBeenCalled();
  });

  it("rejects matured bonds and insufficient float", async () => {
    bondsFindOne.mockResolvedValue({
      _id: bondId,
      marketPrice: MARKET,
      publicFloat: 1000,
      maturityTurn: 3,
      currencyCode: "USD",
    });
    expect((await nppBuyBond(db, npp, bondId, UNITS, 4, 1)).ok).toBe(false);

    bondsFindOne.mockResolvedValue({
      _id: bondId,
      marketPrice: MARKET,
      publicFloat: 2,
      maturityTurn: 100,
      currencyCode: "USD",
    });
    expect((await nppBuyBond(db, npp, bondId, UNITS, 4, 1)).ok).toBe(false);
    expect(applyBondBuySpend).not.toHaveBeenCalled();
  });
});
