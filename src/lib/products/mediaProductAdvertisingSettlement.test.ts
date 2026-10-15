import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { settleMediaProductAdvertisingObligations } from "./mediaProductAdvertisingSettlement";
import {
  createMediaProductAdvertisingObligation,
  mediaProductAdvertisingTransition,
  productAdvertisingSettlementKey,
  productAdvertisingTransition,
} from "./mediaProductAdvertisingSettlement";
import { productAdvertisingDenominationWitness } from "./rules/productAdvertising";

describe("media product advertising denomination recovery", () => {
  it("keeps media journal identity and selects manufacturing receipt fields by family", () => {
    const buyerId = new ObjectId();
    const sellerId = new ObjectId();
    const obligation = createMediaProductAdvertisingObligation({
      buyerCorporationId: buyerId.toHexString(),
      projectId: "shared-project",
      turn: 8,
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
    expect(productAdvertisingSettlementKey(buyerId.toHexString(), obligation!)).toBe(
      `media-product-advertising:8:${buyerId.toHexString()}:shared-project`
    );

    const manufacturing = productAdvertisingTransition(buyerId, obligation!, "manufacturing");
    expect(manufacturing).toMatchObject({
      key: `manufacturing-product-advertising:8:${buyerId.toHexString()}:shared-project`,
      kind: "manufacturing.product.advertising",
      event: { command: "turn.manufacturingProductAdvertising" },
    });
    expect(manufacturing.projections[0]).toMatchObject({
      collection: "productAdvertisingPayables",
      insert: {
        _id: `manufacturing-product-advertising:8:${buyerId.toHexString()}:shared-project`,
        poolId: "manufacturing:USD",
        poolAmountLocal: 10,
      },
    });
    expect(manufacturing.projections[1]?.update).toEqual({
      $set: {
        manufacturingProductAdvertisingReceiptV2: {
          projectId: "shared-project",
          turn: 8,
          amountAnchor: 10,
          sellerCorporationIds: [sellerId.toHexString()],
        },
      },
      $pull: {
        manufacturingProductAdvertisingObligationsV2: {
          projectId: "shared-project",
          turn: 8,
        },
      },
    });
  });

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
    expect(transition.legs[1]).toMatchObject({
      kind: "credit",
      collection: "productAdvertisingClearing",
      filter: { _id: "media:USD" },
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
    const move = (await db.collection("bankMoneyMoves").find({}).toArray())[0] as
      { status?: string; legs?: Array<{ applied?: boolean }> } | undefined;
    expect(move?.status).toBe("rejected");
    expect(move?.legs?.some((leg) => leg.applied)).toBe(false);
  });

  it("funds the order into the pool and defers a seller whose denomination changed", async () => {
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

    const touched = await settleMediaProductAdvertisingObligations(db as never, [buyerId], 11);

    const buyer = await db.collection("corporations").findOne({ _id: buyerId });
    const seller = await db.collection("corporations").findOne({ _id: sellerId });
    // The buyer's order is funded and published; the seller's frozen payable
    // waits in the clearing pool until its denomination guard passes again.
    expect(buyer?.liquidCapital).toBe(80);
    expect(buyer?.mediaProductAdvertisingReceiptV1).toMatchObject({ projectId: "title-seller-fx" });
    expect(buyer?.mediaProductAdvertisingObligationsV1).toEqual([]);
    expect(seller?.liquidCapital).toBe(50);
    expect(
      (await db.collection("productAdvertisingClearing").findOne({ _id: "media:USD" }))?.cashLocal
    ).toBe(20);
    const order = (await db
      .collection("bankMoneyMoves")
      .findOne({ kind: "media.product.advertising" })) as {
      status?: string;
      legs?: Array<{ applied?: boolean }>;
    } | null;
    expect(order?.status).toBe("applied");
    expect(order?.legs?.map((leg) => leg.applied)).toEqual([true, true]);
    // The ineligible seller is deferred before any clearing claims a key.
    expect(
      await db
        .collection("bankMoneyMoves")
        .countDocuments({ kind: "media.product.advertising.clearing" })
    ).toBe(0);
    expect(await db.collection("productAdvertisingPayables").countDocuments({})).toBe(1);
    // Only the buyer's cash moved this call.
    expect(touched.map((id) => id.toHexString())).toEqual([buyerId.toHexString()]);
  });

  it("pays the deferred seller payable once its denomination returns", async () => {
    const buyerId = new ObjectId();
    const sellerId = new ObjectId();
    const obligation = createMediaProductAdvertisingObligation({
      buyerCorporationId: buyerId.toHexString(),
      projectId: "title-seller-restored-fx",
      turn: 12,
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

    await settleMediaProductAdvertisingObligations(db as never, [buyerId], 12);
    expect((await db.collection("corporations").findOne({ _id: buyerId }))?.liquidCapital).toBe(80);
    expect((await db.collection("corporations").findOne({ _id: sellerId }))?.liquidCapital).toBe(
      50
    );
    expect(
      (await db.collection("productAdvertisingClearing").findOne({ _id: "media:USD" }))?.cashLocal
    ).toBe(20);

    await db
      .collection("corporations")
      .updateOne({ _id: sellerId }, { $set: { countryId: "US", liquidCurrencyCode: "USD" } });
    const touched = await settleMediaProductAdvertisingObligations(db as never, [buyerId], 12);

    const buyer = await db.collection("corporations").findOne({ _id: buyerId });
    const seller = await db.collection("corporations").findOne({ _id: sellerId });
    expect(buyer?.liquidCapital).toBe(80);
    expect(buyer?.mediaProductAdvertisingReceiptV1).toMatchObject({
      projectId: "title-seller-restored-fx",
      turn: 12,
      amountAnchor: 10,
      sellerCorporationIds: [sellerId.toHexString()],
    });
    expect(buyer?.mediaProductAdvertisingObligationsV1).toEqual([]);
    expect(seller?.liquidCapital).toBe(70);
    const move = (await db
      .collection("bankMoneyMoves")
      .findOne({ kind: "media.product.advertising.clearing" })) as {
      status?: string;
      legs?: Array<{ applied?: boolean }>;
    } | null;
    expect(move?.status).toBe("applied");
    expect(move?.legs?.map((leg) => leg.applied)).toEqual([true, true]);
    expect(await db.collection("bankMoneyMoves").countDocuments({})).toBe(2);
    expect(await db.collection("productAdvertisingPayables").countDocuments({})).toBe(0);
    expect(
      (await db.collection("productAdvertisingClearing").findOne({ _id: "media:USD" }))?.cashLocal
    ).toBe(0);
    expect(touched.map((id) => id.toHexString())).toContain(sellerId.toHexString());
  });

  it("keeps later obligations behind the single unconsumed receipt slot", async () => {
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
    const createOrder = (projectId: string) =>
      createMediaProductAdvertisingObligation({
        buyerCorporationId: buyerId.toHexString(),
        projectId,
        turn: 13,
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
    const first = createOrder("title-first");
    const second = createOrder("title-second");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    const db = createInMemoryDb();
    db.seed("corporations", [
      {
        _id: buyerId,
        countryId: "US",
        liquidCurrencyCode: "USD",
        liquidCapital: 100,
        mediaProductAdvertisingObligationsV1: [first, second],
      },
      {
        _id: sellerId,
        countryId: "US",
        liquidCurrencyCode: "USD",
        liquidCapital: 50,
      },
    ]);

    await settleMediaProductAdvertisingObligations(db as never, [buyerId], 13);
    let buyer = await db.collection("corporations").findOne({ _id: buyerId });
    let seller = await db.collection("corporations").findOne({ _id: sellerId });
    expect(buyer?.liquidCapital).toBe(80);
    expect(buyer?.mediaProductAdvertisingReceiptV1).toMatchObject({ projectId: "title-first" });
    expect(buyer?.mediaProductAdvertisingObligationsV1).toHaveLength(1);
    expect(seller?.liquidCapital).toBe(70);
    expect(await db.collection("bankMoneyMoves").countDocuments({})).toBe(2);

    await db
      .collection("corporations")
      .updateOne({ _id: buyerId }, { $unset: { mediaProductAdvertisingReceiptV1: "" } });
    await settleMediaProductAdvertisingObligations(db as never, [buyerId], 13);
    buyer = await db.collection("corporations").findOne({ _id: buyerId });
    seller = await db.collection("corporations").findOne({ _id: sellerId });
    expect(buyer?.liquidCapital).toBe(60);
    expect(buyer?.mediaProductAdvertisingReceiptV1).toMatchObject({ projectId: "title-second" });
    expect(buyer?.mediaProductAdvertisingObligationsV1).toEqual([]);
    expect(seller?.liquidCapital).toBe(90);
    expect(await db.collection("bankMoneyMoves").countDocuments({})).toBe(4);
  });
});
