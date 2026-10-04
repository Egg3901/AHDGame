import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { settleMediaProductAdvertisingObligations } from "./mediaProductAdvertisingSettlement";
import {
  createMediaProductAdvertisingObligation,
  mediaProductAdvertisingTransition,
} from "./mediaProductAdvertisingSettlement";
import { productAdvertisingDenominationWitness } from "./rules/productAdvertising";

describe("media product advertising denomination recovery", () => {
  it("discards an unwitnessed legacy order before creating any journal entry", async () => {
    const buyerId = new ObjectId();
    const sellerId = new ObjectId();
    const obligation = createMediaProductAdvertisingObligation({
      buyerCorporationId: buyerId.toHexString(),
      projectId: "legacy-title",
      turn: 9,
      amountAnchor: 10,
      buyerCurrencyCode: "USD",
      buyerLocalPerAnchor: 1,
      buyerDenomination: productAdvertisingDenominationWitness({
        liquidCurrencyCode: "USD",
        countryId: "US",
      }),
      sellers: [
        {
          corporationId: sellerId.toHexString(),
          deliveredValueAnchor: 10,
          currencyCode: "USD",
          localPerAnchor: 1,
          ...productAdvertisingDenominationWitness({
            liquidCurrencyCode: "USD",
            countryId: "US",
          }),
        },
      ],
    });
    expect(obligation).not.toBeNull();
    const { buyerDenomination: _buyer, ...legacy } = obligation!;
    const legacyObligation = {
      ...legacy,
      sellerAllocations: legacy.sellerAllocations.map(
        ({ denomination: _seller, ...seller }) => seller
      ),
    };
    const db = createInMemoryDb();
    db.seed("corporations", [
      {
        _id: buyerId,
        countryId: "US",
        liquidCurrencyCode: "USD",
        liquidCapital: 100,
        mediaProductAdvertisingObligationsV1: [legacyObligation],
      },
      {
        _id: sellerId,
        countryId: "US",
        liquidCurrencyCode: "USD",
        liquidCapital: 50,
      },
    ]);

    await settleMediaProductAdvertisingObligations(db as never, [buyerId], 9);

    const buyer = await db.collection("corporations").findOne({ _id: buyerId });
    const seller = await db.collection("corporations").findOne({ _id: sellerId });
    expect(buyer?.liquidCapital).toBe(100);
    expect(buyer?.mediaProductAdvertisingObligationsV1).toEqual([]);
    expect(buyer?.mediaProductAdvertisingReceiptV1).toBeUndefined();
    expect(seller?.liquidCapital).toBe(50);
    expect(await db.collection("bankMoneyMoves").countDocuments({})).toBe(0);
  });

  it("cancels a frozen order when the buyer denomination changes before any cash leg lands", async () => {
    const buyerId = new ObjectId();
    const sellerId = new ObjectId();
    const buyerDenomination = productAdvertisingDenominationWitness({
      liquidCurrencyCode: "USD",
      countryId: "US",
    });
    const sellerDenomination = productAdvertisingDenominationWitness({
      liquidCurrencyCode: "USD",
      countryId: "US",
    });
    const obligation = createMediaProductAdvertisingObligation({
      buyerCorporationId: buyerId.toHexString(),
      projectId: "title-1",
      turn: 10,
      amountAnchor: 10,
      buyerCurrencyCode: "USD",
      buyerLocalPerAnchor: 2,
      buyerDenomination,
      sellers: [
        {
          corporationId: sellerId.toHexString(),
          deliveredValueAnchor: 10,
          currencyCode: "USD",
          localPerAnchor: 2,
          ...sellerDenomination,
        },
      ],
    });
    expect(obligation).not.toBeNull();
    const transition = mediaProductAdvertisingTransition(buyerId, obligation!);
    expect(transition.legs[0]?.filter).toMatchObject({
      $and: [{ liquidCurrencyCode: "USD" }, { countryId: "US" }],
    });
    expect(transition.legs[1]?.filter).toMatchObject({
      $and: [{ liquidCurrencyCode: "USD" }, { countryId: "US" }],
    });

    const db = createInMemoryDb();
    db.seed("corporations", [
      {
        _id: buyerId,
        countryId: "US",
        liquidCurrencyCode: "CAD",
        liquidCapital: 100,
        mediaProductAdvertisingObligationsV1: [obligation],
      },
      {
        _id: sellerId,
        countryId: "US",
        liquidCurrencyCode: "USD",
        liquidCapital: 50,
      },
    ]);

    await settleMediaProductAdvertisingObligations(db as never, [buyerId], 10);
    expect((await db.collection("corporations").findOne({ _id: buyerId }))?.liquidCapital).toBe(
      100
    );
    expect((await db.collection("corporations").findOne({ _id: sellerId }))?.liquidCapital).toBe(
      50
    );

    const buyer = await db.collection("corporations").findOne({ _id: buyerId });
    const seller = await db.collection("corporations").findOne({ _id: sellerId });
    expect(buyer?.liquidCapital).toBe(100);
    expect(buyer?.mediaProductAdvertisingObligationsV1).toEqual([]);
    expect(buyer?.mediaProductAdvertisingReceiptV1).toBeUndefined();
    expect(seller?.liquidCapital).toBe(50);
    const move = (await db.collection("bankMoneyMoves").find({}).toArray())[0];
    expect(move?.status).toBe("rejected");
    expect(move?.legs.some((leg) => leg.applied)).toBe(false);
  });

  it("keeps the original debit frozen when a quoted seller changes denomination", async () => {
    const buyerId = new ObjectId();
    const sellerId = new ObjectId();
    const obligation = createMediaProductAdvertisingObligation({
      buyerCorporationId: buyerId.toHexString(),
      projectId: "title-seller-fx",
      turn: 11,
      amountAnchor: 10,
      buyerCurrencyCode: "USD",
      buyerLocalPerAnchor: 2,
      buyerDenomination: productAdvertisingDenominationWitness({
        liquidCurrencyCode: "USD",
        countryId: "US",
      }),
      sellers: [
        {
          corporationId: sellerId.toHexString(),
          deliveredValueAnchor: 10,
          currencyCode: "USD",
          localPerAnchor: 2,
          ...productAdvertisingDenominationWitness({
            liquidCurrencyCode: "USD",
            countryId: "US",
          }),
        },
      ],
    });
    expect(obligation).not.toBeNull();
    const db = createInMemoryDb();
    db.seed("corporations", [
      {
        _id: buyerId,
        countryId: "US",
        liquidCurrencyCode: "USD",
        liquidCapital: 100,
        mediaProductAdvertisingObligationsV1: [obligation],
      },
      {
        _id: sellerId,
        countryId: "CA",
        liquidCurrencyCode: "CAD",
        liquidCapital: 50,
      },
    ]);

    await settleMediaProductAdvertisingObligations(db as never, [buyerId], 11);

    const buyer = await db.collection("corporations").findOne({ _id: buyerId });
    const seller = await db.collection("corporations").findOne({ _id: sellerId });
    expect(buyer?.liquidCapital).toBe(80);
    expect(buyer?.mediaProductAdvertisingReceiptV1).toBeUndefined();
    expect(buyer?.mediaProductAdvertisingObligationsV1).toHaveLength(1);
    expect(seller?.liquidCapital).toBe(50);
    const move = (await db.collection("bankMoneyMoves").find({}).toArray())[0];
    expect(move?.status).toBe("partial");
    expect(move?.legs.map((leg) => leg.applied)).toEqual([true, false]);
  });
});
