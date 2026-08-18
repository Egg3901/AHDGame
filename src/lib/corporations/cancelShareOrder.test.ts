import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { actorMayCancelShareOrder, cancelShareOrderAndRefund } from "./cancelShareOrder";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: vi.fn().mockResolvedValue(17),
}));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
});

describe("cancelShareOrderAndRefund — Option B escrow semantics", () => {
  it("converts JPY-escrow refund to USD character wallet via anchor", async () => {
    // JP corp with sharePrice and escrow in JPY.
    // Character: US (USD wallet).
    // Rates: JPY = 100/₳, USD = 1.0/₳.
    // Order: 100 shares × ¥1,000 = ¥100,000 escrow (Option B storage).
    // Cancel refund: ¥100,000 ÷ 100 JPY/₳ = 1,000 ₳ → × 1.0 USD/₳ = 1,000 USD.
    // Pre-Option-B (with my first fix storing ₳): refund would be read as
    // 100,000 ₳ × 1.0 = 100,000 USD — a 100× over-refund.
    const orderId = new ObjectId();
    const targetCorpId = new ObjectId();
    const characterId = new ObjectId();

    const order = {
      _id: orderId,
      corporationId: targetCorpId,
      characterId,
      type: "buy" as const,
      status: "open",
      escrowAmount: 100_000, // ¥ — in JP target corp's currency
      sharesRemaining: 100,
      pricePerShare: 1000,
    };

    // shareOrders collection: updateOne (status: cancelled)
    db.collection("shareOrders");
    db.collectionMocks["shareOrders"].updateOne.mockResolvedValue({ modifiedCount: 1 });

    // corporations collection: findOne on target corp returns JP + JPY
    db.collection("corporations");
    db.collectionMocks["corporations"].findOne.mockImplementation((filter: { _id?: ObjectId }) => {
      if (filter?._id?.equals(targetCorpId)) {
        return Promise.resolve({
          _id: targetCorpId,
          countryId: "JP",
          liquidCurrencyCode: "JPY",
        });
      }
      return Promise.resolve(null);
    });

    // exchangeRates: JPY = 100/₳, USD = 1.0/₳.
    db.collection("exchangeRates");
    db.collectionMocks["exchangeRates"].findOne.mockImplementation(
      (filter: { currencyCode?: string }) => {
        if (filter?.currencyCode === "JPY")
          return Promise.resolve({ currencyCode: "JPY", rate: 100 });
        if (filter?.currencyCode === "USD")
          return Promise.resolve({ currencyCode: "USD", rate: 1.0 });
        return Promise.resolve(null);
      }
    );

    // characters: US character. loadCharacterFxRate reads the exchangeRates
    // collection (covered above). The character findOne here is for countryId.
    db.collection("characters");
    db.collectionMocks["characters"].findOne.mockResolvedValue({
      _id: characterId,
      countryId: "US",
    });
    db.collectionMocks["characters"].updateOne.mockResolvedValue({ modifiedCount: 1 });

    const result = await cancelShareOrderAndRefund(db as never, order as never);

    expect(result).toEqual({ ok: true });

    // Verify the refund hit the character wallet in USD with the anchor-
    // normalized amount (¥100,000 → ₳1,000 → $1,000).
    const updateCall = db.collectionMocks["characters"].updateOne.mock.calls[0];
    const incOp = (updateCall[1] as { $inc: Record<string, number> }).$inc;
    // personal.USD should gain ~1000 (anchor-normalized), not 100000 (raw JPY).
    const personalUSD = incOp["currencyBalances.personal.USD"];
    expect(personalUSD).toBeCloseTo(1000, 2);
  });

  it("refunds corp buy-order escrow across JPY→USD target→placer currency hop", async () => {
    // UK corp placer buys shares in JP corp. Cancel refund hops:
    //   ¥ escrow → ₳ (via target) → GBP (via placer).
    // Rates: JPY = 100/₳, GBP = 0.75/₳.
    // ¥100,000 escrow → ₳1,000 → £750 credited to placer corp liquidCapital.
    const orderId = new ObjectId();
    const targetCorpId = new ObjectId();
    const placerCorpId = new ObjectId();
    const characterId = new ObjectId();

    const order = {
      _id: orderId,
      corporationId: targetCorpId,
      characterId,
      placerCorporationId: placerCorpId,
      type: "buy" as const,
      status: "open",
      escrowAmount: 100_000, // ¥ local
      sharesRemaining: 100,
      pricePerShare: 1000,
    };

    db.collection("shareOrders");
    db.collectionMocks["shareOrders"].updateOne.mockResolvedValue({ modifiedCount: 1 });

    db.collection("corporations");
    db.collectionMocks["corporations"].findOne.mockImplementation((filter: { _id?: ObjectId }) => {
      if (filter?._id?.equals(targetCorpId)) {
        return Promise.resolve({
          _id: targetCorpId,
          countryId: "JP",
          liquidCurrencyCode: "JPY",
        });
      }
      if (filter?._id?.equals(placerCorpId)) {
        return Promise.resolve({
          _id: placerCorpId,
          countryId: "UK",
          liquidCurrencyCode: "GBP",
        });
      }
      return Promise.resolve(null);
    });
    db.collectionMocks["corporations"].updateOne.mockResolvedValue({ modifiedCount: 1 });

    db.collection("exchangeRates");
    db.collectionMocks["exchangeRates"].findOne.mockImplementation(
      (filter: { currencyCode?: string }) => {
        if (filter?.currencyCode === "JPY")
          return Promise.resolve({ currencyCode: "JPY", rate: 100 });
        if (filter?.currencyCode === "GBP")
          return Promise.resolve({ currencyCode: "GBP", rate: 0.75 });
        return Promise.resolve(null);
      }
    );

    const result = await cancelShareOrderAndRefund(db as never, order as never);
    expect(result).toEqual({ ok: true });

    // The placer (UK) corp gets credited with £750 — the GBP equivalent of
    // the ₳1,000 refund. Pre-fix (treating escrow as ₳) this would have
    // credited 100,000 ₳ × 0.75 = £75,000 — 100× over-refund.
    const placerUpdateCall = db.collectionMocks["corporations"].updateOne.mock.calls[0];
    const incOp = (placerUpdateCall[1] as { $inc: Record<string, number> }).$inc;
    expect(incOp["liquidCapital"]).toBeCloseTo(750, 2);
  });

  it("leaves the order open when a buyer FX rate is unavailable", async () => {
    const orderId = new ObjectId();
    const targetCorpId = new ObjectId();
    const characterId = new ObjectId();

    const order = {
      _id: orderId,
      corporationId: targetCorpId,
      characterId,
      type: "buy" as const,
      status: "open",
      escrowAmount: 100_000,
      sharesRemaining: 100,
      pricePerShare: 1000,
    };

    db.collection("shareOrders");
    db.collectionMocks["shareOrders"].updateOne.mockResolvedValue({ matchedCount: 1 });

    db.collection("corporations");
    db.collectionMocks["corporations"].findOne.mockResolvedValue({
      _id: targetCorpId,
      countryId: "JP",
      liquidCurrencyCode: "JPY",
    });

    db.collection("exchangeRates");
    db.collectionMocks["exchangeRates"].findOne.mockImplementation(
      (filter: { currencyCode?: string }) => {
        if (filter?.currencyCode === "JPY") {
          return Promise.resolve({ currencyCode: "JPY", rate: 100 });
        }
        return Promise.resolve(null);
      }
    );

    db.collection("characters");
    db.collectionMocks["characters"].findOne.mockResolvedValue({
      _id: characterId,
      countryId: "UK",
      name: "Buyer",
    });

    const result = await cancelShareOrderAndRefund(db as never, order as never);

    expect(result).toEqual({ ok: false, error: "Exchange rate unavailable, try again shortly" });
    expect(db.collectionMocks["shareOrders"].updateOne).not.toHaveBeenCalled();
  });

  it("cancels an orphaned buy order even when the owner document is missing", async () => {
    const orderId = new ObjectId();
    const targetCorpId = new ObjectId();
    const characterId = new ObjectId();

    const order = {
      _id: orderId,
      corporationId: targetCorpId,
      characterId,
      type: "buy" as const,
      status: "open",
      escrowAmount: 50_000,
      sharesRemaining: 50,
      pricePerShare: 1000,
    };

    db.collection("shareOrders");
    db.collectionMocks["shareOrders"].updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });

    db.collection("corporations");
    db.collectionMocks["corporations"].findOne.mockResolvedValue({
      _id: targetCorpId,
      countryId: "JP",
      liquidCurrencyCode: "JPY",
    });

    db.collection("exchangeRates");
    db.collectionMocks["exchangeRates"].findOne.mockResolvedValue({
      currencyCode: "JPY",
      rate: 100,
    });

    db.collection("characters");
    db.collectionMocks["characters"].findOne.mockResolvedValue(null);
    db.collection("imperialCharacters");
    db.collectionMocks["imperialCharacters"].findOne.mockResolvedValue(null);

    const result = await cancelShareOrderAndRefund(db as never, order as never);

    expect(result).toEqual({ ok: true });
    expect(db.collectionMocks["shareOrders"].updateOne).toHaveBeenCalledWith(
      { _id: orderId, status: "open" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "cancelled" }),
      })
    );
  });

  it("cancels an orphaned corp-placed buy order when the placer corp is missing", async () => {
    // Repro: placer corp was dissolved while leaving an open buy order. Pre-fix
    // this hard-failed with "Buyer corporation not found", blocking reverse
    // splits indefinitely (ticket #0461). New behavior mirrors the orphan-
    // character branch: cancel the order without refund (escrow can't be
    // returned, but the orphan can't keep blocking the target corp either).
    const orderId = new ObjectId();
    const targetCorpId = new ObjectId();
    const placerCorpId = new ObjectId();
    const characterId = new ObjectId();

    const order = {
      _id: orderId,
      corporationId: targetCorpId,
      characterId,
      placerCorporationId: placerCorpId,
      type: "buy" as const,
      status: "open",
      escrowAmount: 100_000,
      sharesRemaining: 10,
      pricePerShare: 11.47,
    };

    db.collection("shareOrders");
    db.collectionMocks["shareOrders"].updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });

    db.collection("corporations");
    // Target corp exists; placer corp is missing (dissolved).
    db.collectionMocks["corporations"].findOne.mockImplementation((filter: { _id?: ObjectId }) => {
      if (filter?._id?.equals(targetCorpId)) {
        return Promise.resolve({
          _id: targetCorpId,
          countryId: "UK",
          liquidCurrencyCode: "GBP",
        });
      }
      return Promise.resolve(null);
    });

    db.collection("exchangeRates");
    db.collectionMocks["exchangeRates"].findOne.mockResolvedValue({
      currencyCode: "GBP",
      rate: 0.75,
    });

    const result = await cancelShareOrderAndRefund(db as never, order as never);

    expect(result).toEqual({ ok: true });
    expect(db.collectionMocks["shareOrders"].updateOne).toHaveBeenCalledWith(
      { _id: orderId, status: "open" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "cancelled" }),
      })
    );
    // No refund should have been attempted on the missing placer corp.
    expect(db.collectionMocks["corporations"].updateOne).not.toHaveBeenCalled();
  });

  it("reopens the order if a corporation refund fails after the cancel claim", async () => {
    const orderId = new ObjectId();
    const targetCorpId = new ObjectId();
    const placerCorpId = new ObjectId();
    const characterId = new ObjectId();

    const order = {
      _id: orderId,
      corporationId: targetCorpId,
      characterId,
      placerCorporationId: placerCorpId,
      type: "buy" as const,
      status: "open",
      escrowAmount: 100_000,
      sharesRemaining: 100,
      pricePerShare: 1000,
    };

    db.collection("shareOrders");
    db.collectionMocks["shareOrders"].updateOne
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });

    db.collection("corporations");
    db.collectionMocks["corporations"].findOne.mockImplementation((filter: { _id?: ObjectId }) => {
      if (filter?._id?.equals(targetCorpId)) {
        return Promise.resolve({
          _id: targetCorpId,
          countryId: "JP",
          liquidCurrencyCode: "JPY",
        });
      }
      if (filter?._id?.equals(placerCorpId)) {
        return Promise.resolve({
          _id: placerCorpId,
          name: "Buyer Corp",
          countryId: "US",
          liquidCurrencyCode: "USD",
        });
      }
      return Promise.resolve(null);
    });
    db.collectionMocks["corporations"].updateOne.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    });

    db.collection("exchangeRates");
    db.collectionMocks["exchangeRates"].findOne.mockImplementation(
      (filter: { currencyCode?: string }) => {
        if (filter?.currencyCode === "JPY")
          return Promise.resolve({ currencyCode: "JPY", rate: 100 });
        if (filter?.currencyCode === "USD")
          return Promise.resolve({ currencyCode: "USD", rate: 1 });
        return Promise.resolve(null);
      }
    );

    const result = await cancelShareOrderAndRefund(db as never, order as never);

    expect(result).toEqual({ ok: false, error: "Buyer corporation not found" });
    expect(db.collectionMocks["shareOrders"].updateOne).toHaveBeenCalledTimes(2);
    expect(db.collectionMocks["shareOrders"].updateOne.mock.calls[1]?.[1]).toMatchObject({
      $set: { status: "open" },
    });
  });
});

describe("actorMayCancelShareOrder", () => {
  const actorId = new ObjectId();
  const placerId = new ObjectId();

  it("allows the authorizing character", () => {
    expect(
      actorMayCancelShareOrder({ characterId: actorId, placerCorporationId: placerId }, actorId, {
        ceoId: new ObjectId(),
        ceoVacant: false,
      })
    ).toBe(true);
  });

  it("allows the sitting CEO of the placing corporation", () => {
    expect(
      actorMayCancelShareOrder(
        { characterId: new ObjectId(), placerCorporationId: placerId },
        actorId,
        { ceoId: actorId, ceoVacant: false }
      )
    ).toBe(true);
  });

  it("rejects a vacant placer CEO and a bystander", () => {
    expect(
      actorMayCancelShareOrder(
        { characterId: new ObjectId(), placerCorporationId: placerId },
        actorId,
        { ceoId: actorId, ceoVacant: true }
      )
    ).toBe(false);
    expect(
      actorMayCancelShareOrder(
        { characterId: new ObjectId(), placerCorporationId: placerId },
        actorId,
        { ceoId: new ObjectId(), ceoVacant: false }
      )
    ).toBe(false);
  });
});
