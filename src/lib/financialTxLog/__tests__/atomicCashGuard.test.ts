import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  atomicallyDebitCharacterCash,
  refundCharacterCash,
  atomicallyDebitCorpLiquidCapital,
  refundCorpLiquidCapital,
  atomicallyDebitImperialCash,
  creditCorpLiquidCapital,
  decrementCorpIssuanceProceeds,
} from "../atomicCashGuard";

describe("atomicallyDebitCharacterCash (forex on)", () => {
  let db: MockDb;
  const charId = new ObjectId();

  beforeEach(() => {
    db = createMockDb();
    db.collection("characters");
  });

  it("debits when balance is sufficient (forex on writes to currencyBalances.personal.USD)", async () => {
    db.collectionMocks.characters.findOneAndUpdate.mockResolvedValue({
      _id: charId,
      currencyBalances: { personal: { USD: 600 }, savings: {}, campaign: 0 },
    });

    const result = await atomicallyDebitCharacterCash(db as never, charId, "USD", 400, true);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.newBalance).toBe(600);

    expect(db.collectionMocks.characters.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: charId, "currencyBalances.personal.USD": { $gte: 400 } },
      expect.objectContaining({
        $inc: { "currencyBalances.personal.USD": -400 },
      }),
      expect.objectContaining({ returnDocument: "after" })
    );
  });

  it("returns insufficient when findOneAndUpdate returns null", async () => {
    db.collectionMocks.characters.findOneAndUpdate.mockResolvedValue(null);

    const result = await atomicallyDebitCharacterCash(db as never, charId, "USD", 400, true);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/insufficient/i);
  });

  it("rejects invalid amount (zero, negative, NaN)", async () => {
    const a = await atomicallyDebitCharacterCash(db as never, charId, "USD", 0, true);
    const b = await atomicallyDebitCharacterCash(db as never, charId, "USD", -1, true);
    const c = await atomicallyDebitCharacterCash(db as never, charId, "USD", NaN, true);

    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(c.ok).toBe(false);
    expect(db.collectionMocks.characters.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe("atomicallyDebitCharacterCash (forex off)", () => {
  let db: MockDb;
  const charId = new ObjectId();

  beforeEach(() => {
    db = createMockDb();
    db.collection("characters");
  });

  it("debits cashOnHand when forexEnabled is false", async () => {
    db.collectionMocks.characters.findOneAndUpdate.mockResolvedValue({
      _id: charId,
      cashOnHand: 600,
    });

    const result = await atomicallyDebitCharacterCash(db as never, charId, "USD", 400, false);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.newBalance).toBe(600);
    expect(db.collectionMocks.characters.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: charId, cashOnHand: { $gte: 400 } },
      expect.objectContaining({ $inc: { cashOnHand: -400 } }),
      expect.objectContaining({ returnDocument: "after" })
    );
  });
});

describe("refundCharacterCash", () => {
  let db: MockDb;
  const charId = new ObjectId();

  beforeEach(() => {
    db = createMockDb();
    db.collection("characters");
  });

  it("credits the personal balance back (forex on)", async () => {
    await refundCharacterCash(db as never, charId, "USD", 400, true);
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalledWith(
      { _id: charId },
      expect.objectContaining({
        $inc: { "currencyBalances.personal.USD": 400 },
      }),
      undefined
    );
  });

  it("credits cashOnHand back (forex off)", async () => {
    await refundCharacterCash(db as never, charId, "USD", 400, false);
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalledWith(
      { _id: charId },
      expect.objectContaining({ $inc: { cashOnHand: 400 } }),
      undefined
    );
  });

  it("is a no-op for invalid amounts", async () => {
    await refundCharacterCash(db as never, charId, "USD", 0, true);
    await refundCharacterCash(db as never, charId, "USD", -1, true);
    await refundCharacterCash(db as never, charId, "USD", NaN, true);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });
});

describe("atomicallyDebitCorpLiquidCapital", () => {
  let db: MockDb;
  const corpId = new ObjectId();

  beforeEach(() => {
    db = createMockDb();
    db.collection("corporations");
  });

  it("debits liquidCapital when sufficient", async () => {
    db.collectionMocks.corporations.findOneAndUpdate.mockResolvedValue({
      _id: corpId,
      liquidCapital: 600,
    });

    const result = await atomicallyDebitCorpLiquidCapital(db as never, corpId, 400);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.newBalance).toBe(600);
    expect(db.collectionMocks.corporations.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: corpId, liquidCapital: { $gte: 400 } }),
      expect.objectContaining({ $inc: { liquidCapital: -400 } }),
      expect.objectContaining({ returnDocument: "after" })
    );
  });

  it("gates the debit on the bank reserve floor as well as the balance", async () => {
    db.collectionMocks.corporations.findOneAndUpdate.mockResolvedValue({
      _id: corpId,
      liquidCapital: 600,
    });

    await atomicallyDebitCorpLiquidCapital(db as never, corpId, 400);

    // The floor rides in the SAME atomic filter as the balance check. A
    // read-then-write pair would let two concurrent spends both pass on stale
    // data and jointly empty the reserve, which is the failure this whole
    // module exists to make impossible.
    const filter = db.collectionMocks.corporations.findOneAndUpdate.mock.calls[0][0];
    expect(filter.$expr).toBeDefined();
    expect(JSON.stringify(filter.$expr)).toContain("bankCharter.reserveFloor");
    expect(JSON.stringify(filter.$expr)).toContain("bankCharter.status");
  });

  it("says the floor blocked the spend rather than reporting the corp broke", async () => {
    db.collectionMocks.corporations.findOneAndUpdate.mockResolvedValue(null);
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      liquidCapital: 10_000,
      bankCharter: { status: "active", reserveFloor: 9_000 },
    });

    const result = await atomicallyDebitCorpLiquidCapital(db as never, corpId, 5_000);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/reserve floor/i);
  });

  it("rejects when corp's liquidCapital insufficient", async () => {
    db.collectionMocks.corporations.findOneAndUpdate.mockResolvedValue(null);

    const result = await atomicallyDebitCorpLiquidCapital(db as never, corpId, 400);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/insufficient/i);
  });
});

describe("refundCorpLiquidCapital", () => {
  let db: MockDb;
  const corpId = new ObjectId();

  beforeEach(() => {
    db = createMockDb();
    db.collection("corporations");
  });

  it("credits liquidCapital back", async () => {
    await refundCorpLiquidCapital(db as never, corpId, 400);
    expect(db.collectionMocks.corporations.updateOne).toHaveBeenCalledWith(
      { _id: corpId },
      expect.objectContaining({ $inc: { liquidCapital: 400 } }),
      undefined
    );
  });
});

describe("atomicallyDebitImperialCash", () => {
  let db: MockDb;
  const impId = new ObjectId();

  beforeEach(() => {
    db = createMockDb();
    db.collection("imperialCharacters");
  });

  it("debits the imperialCharacters collection (forex on)", async () => {
    db.collectionMocks.imperialCharacters.findOneAndUpdate.mockResolvedValue({
      _id: impId,
      currencyBalances: { personal: { GBP: 100 }, savings: {}, campaign: 0 },
    });

    const result = await atomicallyDebitImperialCash(db as never, impId, "GBP", 50, true);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.newBalance).toBe(100);
    expect(db.collectionMocks.imperialCharacters.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: impId, "currencyBalances.personal.GBP": { $gte: 50 } },
      expect.objectContaining({
        $inc: { "currencyBalances.personal.GBP": -50 },
      }),
      expect.objectContaining({ returnDocument: "after" })
    );
  });
});

// Bug #0624: issuance no longer pre-credits the corp; the issuer realizes — and
// the share-price book-floor lever records — proceeds as its OWN float is bought
// (alsoTrackIssuanceProceeds) and backs them out as the float is sold
// (decrementCorpIssuanceProceeds). These two helpers must stay exactly
// reversible so the lever tracks realized cash without drift.
describe("creditCorpLiquidCapital — issuance-proceeds tracking", () => {
  let db: MockDb;
  const corpId = new ObjectId();

  beforeEach(() => {
    db = createMockDb();
    db.collection("corporations");
    db.collectionMocks.corporations.findOneAndUpdate.mockResolvedValue({
      _id: corpId,
      liquidCapital: 5000,
    });
  });

  it("credits ONLY liquidCapital when the issuance flag is omitted (buyer-corp debits, escrow, bonds)", async () => {
    await creditCorpLiquidCapital(db as never, corpId, 400);
    expect(db.collectionMocks.corporations.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: corpId },
      expect.objectContaining({ $inc: { liquidCapital: 400 } }),
      expect.objectContaining({ returnDocument: "after" })
    );
  });

  it("also increments shareIssuanceProceeds when alsoTrackIssuanceProceeds is true (float buy)", async () => {
    await creditCorpLiquidCapital(db as never, corpId, 400, true);
    expect(db.collectionMocks.corporations.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: corpId },
      expect.objectContaining({
        $inc: { liquidCapital: 400, shareIssuanceProceeds: 400 },
      }),
      expect.objectContaining({ returnDocument: "after" })
    );
  });

  it("returns the new liquidCapital balance, or null when the corp is missing / amount invalid", async () => {
    const ok = await creditCorpLiquidCapital(db as never, corpId, 400, true);
    expect(ok).toBe(5000);

    db.collectionMocks.corporations.findOneAndUpdate.mockResolvedValueOnce(null);
    const missing = await creditCorpLiquidCapital(db as never, corpId, 400, true);
    expect(missing).toBeNull();

    const invalid = await creditCorpLiquidCapital(db as never, corpId, 0, true);
    expect(invalid).toBeNull();
  });
});

describe("decrementCorpIssuanceProceeds", () => {
  let db: MockDb;
  const corpId = new ObjectId();

  beforeEach(() => {
    db = createMockDb();
    db.collection("corporations");
  });

  it("decrements shareIssuanceProceeds by the amount and does NOT touch liquidCapital", async () => {
    await decrementCorpIssuanceProceeds(db as never, corpId, 400);
    expect(db.collectionMocks.corporations.updateOne).toHaveBeenCalledWith(
      { _id: corpId },
      expect.objectContaining({ $inc: { shareIssuanceProceeds: -400 } }),
      undefined
    );
    // The cash side is handled separately (atomicallyDebitCorpLiquidCapital);
    // this helper must never move liquidCapital.
    const call = db.collectionMocks.corporations.updateOne.mock.calls[0][1];
    expect(call.$inc.liquidCapital).toBeUndefined();
  });

  it("exactly reverses an alsoTrackIssuanceProceeds credit of the same amount", async () => {
    // A float share bought then sold back at the same price nets to zero on the
    // shareIssuanceProceeds field: +400 (credit) then -400 (decrement).
    db.collectionMocks.corporations.findOneAndUpdate.mockResolvedValue({
      _id: corpId,
      liquidCapital: 1000,
    });
    await creditCorpLiquidCapital(db as never, corpId, 400, true);
    await decrementCorpIssuanceProceeds(db as never, corpId, 400);

    const creditInc = db.collectionMocks.corporations.findOneAndUpdate.mock.calls[0][1].$inc;
    const decrementInc = db.collectionMocks.corporations.updateOne.mock.calls[0][1].$inc;
    expect(creditInc.shareIssuanceProceeds + decrementInc.shareIssuanceProceeds).toBe(0);
  });

  it("is a no-op for invalid amounts (zero, negative, NaN)", async () => {
    await decrementCorpIssuanceProceeds(db as never, corpId, 0);
    await decrementCorpIssuanceProceeds(db as never, corpId, -1);
    await decrementCorpIssuanceProceeds(db as never, corpId, NaN);
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });
});
