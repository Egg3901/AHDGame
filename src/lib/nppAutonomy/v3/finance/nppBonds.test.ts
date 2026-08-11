import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";

vi.mock("@/lib/bonds/bondHolderOps", () => ({ reserveBondUnitsForHolder: vi.fn() }));
import { reserveBondUnitsForHolder } from "@/lib/bonds/bondHolderOps";
import { nppBuyBond } from "./nppBonds";

describe("nppBuyBond", () => {
  const nppId = new ObjectId();
  const bondId = new ObjectId();
  const npp = { _id: nppId, countryId: "US" as const };
  const MARKET = 0.95;
  const UNITS = 10;
  const EXPECTED_COST = Math.round(UNITS * BOND_UNIT_FACE_VALUE * MARKET * 100) / 100;

  let bondsFindOne: ReturnType<typeof vi.fn>;
  let nppFindOneAndUpdate: ReturnType<typeof vi.fn>;
  let nppUpdateOne: ReturnType<typeof vi.fn>;
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
    nppFindOneAndUpdate = vi
      .fn()
      .mockResolvedValue({ _id: nppId, nppInvestmentCashAnchor: 500_000 });
    nppUpdateOne = vi.fn().mockResolvedValue({});
    db = {
      collection: (name: string) =>
        name === "bonds"
          ? { findOne: bondsFindOne }
          : { findOneAndUpdate: nppFindOneAndUpdate, updateOne: nppUpdateOne },
    } as unknown as Db;
  });

  it("buys units: deducts cost (guarded) then reserves to the nppId holder", async () => {
    vi.mocked(reserveBondUnitsForHolder).mockResolvedValue(true);
    const res = await nppBuyBond(db, npp, bondId, UNITS, 4, 1);

    expect(res).toEqual({
      ok: true,
      bondId: bondId.toString(),
      units: UNITS,
      cost: EXPECTED_COST,
      costAnchor: EXPECTED_COST, // homeRate=1 → anchor == local
      investmentCashAnchor: 500_000,
    });
    // investment account deducted with a >= guard (NOT campaign funds)
    const [filter, update] = nppFindOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: nppId, nppInvestmentCashAnchor: { $gte: EXPECTED_COST } });
    expect(update.$inc).toEqual({ nppInvestmentCashAnchor: -EXPECTED_COST });
    // reserved to the nppId holder variant
    const reserveArgs = vi.mocked(reserveBondUnitsForHolder).mock.calls[0];
    expect(reserveArgs[2]).toEqual({ field: "nppId", id: nppId });
    expect(reserveArgs[3]).toBe(UNITS);
    expect(nppUpdateOne).not.toHaveBeenCalled(); // no refund on success
  });

  it("refunds funds if the float was taken before the reserve", async () => {
    vi.mocked(reserveBondUnitsForHolder).mockResolvedValue(false);
    const res = await nppBuyBond(db, npp, bondId, UNITS, 4, 1);

    expect(res.ok).toBe(false);
    // refund: investment account incremented back by cost
    expect(nppUpdateOne).toHaveBeenCalledWith(
      { _id: nppId },
      expect.objectContaining({ $inc: { nppInvestmentCashAnchor: EXPECTED_COST } })
    );
  });

  it("rejects when funds are insufficient (guard returns null), no reserve attempted", async () => {
    nppFindOneAndUpdate.mockResolvedValue(null);
    const res = await nppBuyBond(db, npp, bondId, UNITS, 4, 1);
    expect(res).toEqual({
      ok: false,
      reason: "Insufficient investment capital for bond purchase.",
    });
    expect(reserveBondUnitsForHolder).not.toHaveBeenCalled();
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
  });
});
