import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";

vi.mock("@/lib/corporations/shareholderOps", () => ({
  creditSharesToNpp: vi.fn(),
  debitSharesFromNpp: vi.fn(),
}));
vi.mock("@/lib/corporations/shareEscrowSettlement", () => ({
  applyFloatBuyCredit: vi.fn(),
  settleFloatSellDebit: vi.fn(),
  reverseFloatSellDebit: vi.fn(),
  onFloatSellCommitted: vi.fn(),
}));
import { creditSharesToNpp, debitSharesFromNpp } from "@/lib/corporations/shareholderOps";
import {
  applyFloatBuyCredit,
  settleFloatSellDebit,
  reverseFloatSellDebit,
  onFloatSellCommitted,
} from "@/lib/corporations/shareEscrowSettlement";
import { nppBuyShares, nppSellShares } from "./nppShares";

describe("nppBuyShares", () => {
  const nppId = new ObjectId();
  const corpId = new ObjectId();
  const npp = { _id: nppId, countryId: "US" as const };
  const SHARE_PRICE = 42;
  const SHARES = 10;
  const EXPECTED_COST = Math.round(SHARES * SHARE_PRICE * 100) / 100;

  let corpFindOne: ReturnType<typeof vi.fn>;
  let nppFindOneAndUpdate: ReturnType<typeof vi.fn>;
  let nppUpdateOne: ReturnType<typeof vi.fn>;
  let db: Db;

  beforeEach(() => {
    vi.clearAllMocks();
    corpFindOne = vi.fn().mockResolvedValue({
      _id: corpId,
      sharePrice: SHARE_PRICE,
      totalShares: 100_000,
      publicFloat: 5_000,
      liquidCurrencyCode: "USD",
    });
    nppFindOneAndUpdate = vi
      .fn()
      .mockResolvedValue({ _id: nppId, nppInvestmentCashAnchor: 500_000 });
    nppUpdateOne = vi.fn().mockResolvedValue({});
    db = {
      collection: (name: string) =>
        name === "corporations"
          ? { findOne: corpFindOne }
          : { findOneAndUpdate: nppFindOneAndUpdate, updateOne: nppUpdateOne },
    } as unknown as Db;
  });

  it("buys shares: deducts cost (guarded) then credits the nppId holder", async () => {
    vi.mocked(creditSharesToNpp).mockResolvedValue(true);
    const res = await nppBuyShares(db, npp, corpId, SHARES, 1);

    expect(res).toEqual({
      ok: true,
      corporationId: corpId.toString(),
      shares: SHARES,
      cost: EXPECTED_COST,
      costAnchor: EXPECTED_COST, // homeRate=1 → anchor == local
      investmentCashAnchor: 500_000,
    });
    // investment account deducted with a >= guard (NOT campaign funds)
    const [filter, update] = nppFindOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: nppId, nppInvestmentCashAnchor: { $gte: EXPECTED_COST } });
    expect(update.$inc).toEqual({ nppInvestmentCashAnchor: -EXPECTED_COST });
    // credited to the nppId holder variant
    const creditArgs = vi.mocked(creditSharesToNpp).mock.calls[0];
    expect(creditArgs[1]).toBe(corpId);
    expect(creditArgs[2]).toBe(nppId);
    expect(creditArgs[3]).toBe(SHARES);
    expect(creditArgs[4]).toBe(SHARE_PRICE);
    // treasury credit conserves money
    expect(applyFloatBuyCredit).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ _id: corpId }),
      SHARES * SHARE_PRICE
    );
    expect(nppUpdateOne).not.toHaveBeenCalled(); // no refund on success
  });

  it("refunds funds if the float was taken before the credit", async () => {
    vi.mocked(creditSharesToNpp).mockResolvedValue(false);
    const res = await nppBuyShares(db, npp, corpId, SHARES, 1);

    expect(res.ok).toBe(false);
    expect(nppUpdateOne).toHaveBeenCalledWith(
      { _id: nppId },
      expect.objectContaining({ $inc: { nppInvestmentCashAnchor: EXPECTED_COST } })
    );
    expect(applyFloatBuyCredit).not.toHaveBeenCalled();
  });

  it("rejects when funds are insufficient (guard returns null), no credit attempted", async () => {
    nppFindOneAndUpdate.mockResolvedValue(null);
    const res = await nppBuyShares(db, npp, corpId, SHARES, 1);
    expect(res).toEqual({
      ok: false,
      reason: "Insufficient investment capital for share purchase.",
    });
    expect(creditSharesToNpp).not.toHaveBeenCalled();
  });

  it("rejects corporations outside the NPP's home currency (no FX)", async () => {
    corpFindOne.mockResolvedValue({
      _id: corpId,
      sharePrice: SHARE_PRICE,
      totalShares: 100_000,
      publicFloat: 5_000,
      liquidCurrencyCode: "GBP",
    });
    const res = await nppBuyShares(db, npp, corpId, SHARES, 1);
    expect(res).toEqual({ ok: false, reason: "NPPs only buy shares in their home currency." });
  });

  it("rejects private, nationalized, national-owned, and float-insufficient corps", async () => {
    corpFindOne.mockResolvedValue({
      _id: corpId,
      sharePrice: SHARE_PRICE,
      totalShares: 100_000,
      publicFloat: 5_000,
      liquidCurrencyCode: "USD",
      isPrivate: true,
    });
    expect((await nppBuyShares(db, npp, corpId, SHARES, 1)).ok).toBe(false);

    corpFindOne.mockResolvedValue({
      _id: corpId,
      sharePrice: SHARE_PRICE,
      totalShares: 100_000,
      publicFloat: 5_000,
      liquidCurrencyCode: "USD",
      isNationalized: true,
    });
    expect((await nppBuyShares(db, npp, corpId, SHARES, 1)).ok).toBe(false);

    corpFindOne.mockResolvedValue({
      _id: corpId,
      sharePrice: SHARE_PRICE,
      totalShares: 100_000,
      publicFloat: 5_000,
      liquidCurrencyCode: "USD",
      countryOwnerId: "US",
    });
    expect((await nppBuyShares(db, npp, corpId, SHARES, 1)).ok).toBe(false);

    corpFindOne.mockResolvedValue({
      _id: corpId,
      sharePrice: SHARE_PRICE,
      totalShares: 100_000,
      publicFloat: 2,
      liquidCurrencyCode: "USD",
    });
    expect((await nppBuyShares(db, npp, corpId, SHARES, 1)).ok).toBe(false);
  });

  it("rejects a missing corporation and non-positive share counts", async () => {
    corpFindOne.mockResolvedValue(null);
    expect((await nppBuyShares(db, npp, corpId, SHARES, 1)).ok).toBe(false);

    expect(await nppBuyShares(db, npp, corpId, 0)).toEqual({
      ok: false,
      reason: "Shares must be a positive integer.",
    });
    expect(await nppBuyShares(db, npp, corpId, 1.5)).toEqual({
      ok: false,
      reason: "Shares must be a positive integer.",
    });
  });
});

describe("nppSellShares", () => {
  const nppId = new ObjectId();
  const corpId = new ObjectId();
  const npp = { _id: nppId, countryId: "US" as const };
  const SHARE_PRICE = 42;
  const SHARES = 10;
  const CURRENT_TURN = 100;
  const EXPECTED_PROCEEDS = Math.round(SHARES * SHARE_PRICE * 100) / 100;

  let corpFindOne: ReturnType<typeof vi.fn>;
  let nppFindOneAndUpdate: ReturnType<typeof vi.fn>;
  let db: Db;

  function baseCorp(overrides: Record<string, unknown> = {}) {
    return {
      _id: corpId,
      sharePrice: SHARE_PRICE,
      totalShares: 100_000,
      publicFloat: 5_000,
      liquidCurrencyCode: "USD",
      ceoId: new ObjectId(), // different from nppId — no CEO-vacate by default
      shareholders: [{ nppId, shares: SHARES }],
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    corpFindOne = vi.fn().mockResolvedValue(baseCorp());
    nppFindOneAndUpdate = vi
      .fn()
      .mockResolvedValue({ _id: nppId, nppInvestmentCashAnchor: 500_000 });
    db = {
      collection: (name: string) =>
        name === "corporations"
          ? { findOne: corpFindOne }
          : { findOneAndUpdate: nppFindOneAndUpdate },
    } as unknown as Db;
    vi.mocked(settleFloatSellDebit).mockResolvedValue({ ok: true });
    vi.mocked(debitSharesFromNpp).mockResolvedValue(SHARES); // some shares remain
  });

  it("sells shares: settles the issuer buyback, debits the nppId holder, credits funds", async () => {
    const res = await nppSellShares(db, npp, corpId, SHARES, CURRENT_TURN, 1);

    expect(res).toEqual({
      ok: true,
      corporationId: corpId.toString(),
      shares: SHARES,
      proceeds: EXPECTED_PROCEEDS,
      proceedsAnchor: EXPECTED_PROCEEDS, // homeRate=1 → anchor == local
      investmentCashAnchor: 500_000,
    });
    expect(settleFloatSellDebit).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ _id: corpId }),
      EXPECTED_PROCEEDS
    );
    const debitArgs = vi.mocked(debitSharesFromNpp).mock.calls[0];
    expect(debitArgs[1]).toBe(corpId);
    expect(debitArgs[2]).toBe(nppId);
    expect(debitArgs[3]).toBe(SHARES);
    expect(debitArgs[5]).toEqual({ requireSufficient: true });
    // proceeds credited to the investment account (NOT campaign funds)
    expect(nppFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: nppId },
      expect.objectContaining({ $inc: { nppInvestmentCashAnchor: EXPECTED_PROCEEDS } }),
      { returnDocument: "after" }
    );
    expect(onFloatSellCommitted).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ _id: corpId }),
      EXPECTED_PROCEEDS
    );
    expect(reverseFloatSellDebit).not.toHaveBeenCalled();
  });

  it("vacates the CEO seat when the selling NPP is the CEO selling their entire stake", async () => {
    corpFindOne.mockResolvedValue(baseCorp({ ceoId: nppId }));
    await nppSellShares(db, npp, corpId, SHARES, CURRENT_TURN, 1);

    const corpUpdate = vi.mocked(debitSharesFromNpp).mock.calls[0][4] as Record<string, unknown>;
    expect(corpUpdate.$set).toMatchObject({ ceoVacant: true, ceoVacantSinceTurn: CURRENT_TURN });
    expect(corpUpdate.$unset).toEqual({ ceoId: "" });
  });

  it("does not vacate the CEO seat on a partial sale", async () => {
    corpFindOne.mockResolvedValue(
      baseCorp({ ceoId: nppId, shareholders: [{ nppId, shares: 20 }] })
    );
    await nppSellShares(db, npp, corpId, SHARES, CURRENT_TURN, 1); // sells 10 of 20

    const corpUpdate = vi.mocked(debitSharesFromNpp).mock.calls[0][4] as Record<string, unknown>;
    expect(corpUpdate.$set).not.toHaveProperty("ceoVacant");
    expect(corpUpdate.$unset).toBeUndefined();
  });

  it("reverses the issuer settlement if the debit loses a float race", async () => {
    vi.mocked(debitSharesFromNpp).mockResolvedValue(-1);
    const res = await nppSellShares(db, npp, corpId, SHARES, CURRENT_TURN, 1);

    expect(res).toEqual({ ok: false, reason: "Shares no longer available; sale reversed." });
    // The reversal must thread the settlement's escrow/treasury `split` back
    // through so both legs are undone exactly (escrow money-printing fix #2943).
    // Here settleFloatSellDebit is mocked to instant mode, so split is undefined.
    expect(reverseFloatSellDebit).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ _id: corpId }),
      EXPECTED_PROCEEDS,
      { split: undefined }
    );
    expect(nppFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects when the issuer treasury can't cover the buyback, no debit attempted", async () => {
    vi.mocked(settleFloatSellDebit).mockResolvedValue({ ok: false });
    const res = await nppSellShares(db, npp, corpId, SHARES, CURRENT_TURN, 1);

    expect(res).toEqual({ ok: false, reason: "Issuer treasury can't cover this sale." });
    expect(debitSharesFromNpp).not.toHaveBeenCalled();
  });

  it("rejects when the NPP owns fewer shares than requested", async () => {
    corpFindOne.mockResolvedValue(baseCorp({ shareholders: [{ nppId, shares: 3 }] }));
    const res = await nppSellShares(db, npp, corpId, SHARES, CURRENT_TURN, 1);
    expect(res).toEqual({ ok: false, reason: "Only 3 shares owned." });
    expect(settleFloatSellDebit).not.toHaveBeenCalled();
  });

  it("rejects corporations outside the NPP's home currency (no FX)", async () => {
    corpFindOne.mockResolvedValue(baseCorp({ liquidCurrencyCode: "GBP" }));
    const res = await nppSellShares(db, npp, corpId, SHARES, CURRENT_TURN, 1);
    expect(res).toEqual({ ok: false, reason: "NPPs only sell shares in their home currency." });
  });

  it("rejects private, nationalized, and national-owned corps", async () => {
    corpFindOne.mockResolvedValue(baseCorp({ isPrivate: true }));
    expect((await nppSellShares(db, npp, corpId, SHARES, CURRENT_TURN, 1)).ok).toBe(false);

    corpFindOne.mockResolvedValue(baseCorp({ isNationalized: true }));
    expect((await nppSellShares(db, npp, corpId, SHARES, CURRENT_TURN, 1)).ok).toBe(false);

    corpFindOne.mockResolvedValue(baseCorp({ countryOwnerId: "US" }));
    expect((await nppSellShares(db, npp, corpId, SHARES, CURRENT_TURN, 1)).ok).toBe(false);
  });

  it("rejects a missing corporation and non-positive share counts", async () => {
    corpFindOne.mockResolvedValue(null);
    expect((await nppSellShares(db, npp, corpId, SHARES, CURRENT_TURN, 1)).ok).toBe(false);

    expect(await nppSellShares(db, npp, corpId, 0, CURRENT_TURN)).toEqual({
      ok: false,
      reason: "Shares must be a positive integer.",
    });
  });
});
