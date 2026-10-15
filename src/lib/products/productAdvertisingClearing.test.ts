import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { settleTransition } from "@/lib/banking/settlementJournal";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  legacyProductAdvertisingTransition,
  settleProductAdvertisingObligations,
} from "./mediaProductAdvertisingSettlement";
import {
  PRODUCT_ADVERTISING_CLEARING_COLLECTION,
  PRODUCT_ADVERTISING_PAYABLES_COLLECTION,
  productAdvertisingClearingTransition,
  type ProductAdvertisingPayable,
} from "./productAdvertisingClearing";
import {
  productAdvertisingDenominationWitness,
  quoteFundedProductAdvertising,
  type ProductAdvertisingObligation,
} from "./rules/productAdvertising";

const COUNTRY: Record<string, string> = { USD: "US", EUR: "DE", GBP: "GB", CAD: "CA" };

interface Corp {
  _id: ObjectId;
  currency: CurrencyCode;
  rate: number;
}

function corp(currency: CurrencyCode, rate: number): Corp {
  return { _id: new ObjectId(), currency, rate };
}

function witness(c: Corp) {
  return productAdvertisingDenominationWitness({
    liquidCurrencyCode: c.currency,
    countryId: COUNTRY[c.currency],
  });
}

function order(
  buyer: Corp,
  sellers: readonly Corp[],
  amountAnchor: number,
  turn: number,
  projectId: string,
  buyerRate = buyer.rate,
  sellerRates: readonly number[] = sellers.map((seller) => seller.rate)
): ProductAdvertisingObligation {
  const quote = quoteFundedProductAdvertising({
    amountAnchor,
    buyer: {
      corporationId: buyer._id.toHexString(),
      currencyCode: buyer.currency,
      localPerAnchor: buyerRate,
      ...witness(buyer),
    },
    sellers: sellers.map((seller, index) => ({
      corporationId: seller._id.toHexString(),
      currencyCode: seller.currency,
      localPerAnchor: sellerRates[index],
      deliveredValueAnchor: 1 + ((index * 7919) % 97),
      ...witness(seller),
    })),
  });
  if (!quote) throw new Error("quote failed");
  return { projectId, turn, ...quote };
}

function seedWorld(
  db: InMemoryDb,
  buyers: ReadonlyArray<{ buyer: Corp; obligations: ProductAdvertisingObligation[] }>,
  sellers: readonly Corp[],
  family: "media" | "manufacturing" = "media"
) {
  const field =
    family === "media"
      ? "mediaProductAdvertisingObligationsV1"
      : "manufacturingProductAdvertisingObligationsV2";
  db.seed("corporations", [
    ...buyers.map(({ buyer, obligations }) => ({
      _id: buyer._id,
      liquidCurrencyCode: buyer.currency,
      countryId: COUNTRY[buyer.currency],
      liquidCapital: 1_000_000,
      [field]: obligations,
    })),
    ...sellers.map((seller) => ({
      _id: seller._id,
      liquidCurrencyCode: seller.currency,
      countryId: COUNTRY[seller.currency],
      liquidCapital: 0,
    })),
  ]);
}

async function cash(db: InMemoryDb, id: ObjectId): Promise<number> {
  return ((await db.collection("corporations").findOne({ _id: id }))?.liquidCapital as number) ?? 0;
}

async function poolTotal(db: InMemoryDb): Promise<number> {
  const pools = await db.collection(PRODUCT_ADVERTISING_CLEARING_COLLECTION).find({}).toArray();
  return pools.reduce((sum, pool) => sum + Math.abs((pool.cashLocal as number) ?? 0), 0);
}

/** What the old one-transition-per-order path paid each seller. */
function expectedSellerTotals(obligations: readonly ProductAdvertisingObligation[]) {
  const totals = new Map<string, number>();
  for (const obligation of obligations)
    for (const seller of obligation.sellerAllocations)
      totals.set(
        seller.corporationId,
        (totals.get(seller.corporationId) ?? 0) + seller.amountLocal
      );
  return totals;
}

async function journalRecords(db: InMemoryDb, kind: string) {
  return (await db.collection("bankMoneyMoves").find({ kind }).toArray()) as Array<{
    _id: string;
    status?: string;
    legs: Array<{ kind: string; applied?: boolean }>;
  }>;
}

const CLEARING = "media.product.advertising.clearing";
const ORDER = "media.product.advertising";

describe("product advertising clearing pool", () => {
  it("pays every seller its exact frozen total across currencies and frozen rates", async () => {
    const usdBuyer = corp("USD", 1);
    const usdBuyerLater = corp("USD", 1);
    const eurBuyer = corp("EUR", 0.9);
    const sellers = [
      corp("USD", 1),
      corp("EUR", 0.9),
      corp("GBP", 0.8),
      corp("CAD", 1.35),
      corp("GBP", 0.8),
    ];
    // Same USD pool, two different frozen buyer rates; sellers frozen at
    // different rates in the two USD orders too.
    const a = order(usdBuyer, sellers, 123.457, 20, "a");
    const b = order(usdBuyerLater, sellers, 77.31, 20, "b", 1.1, [1.1, 0.95, 0.81, 1.4, 0.79]);
    const c = order(eurBuyer, sellers, 1000.01, 20, "c");
    const db = createInMemoryDb();
    seedWorld(
      db,
      [
        { buyer: usdBuyer, obligations: [a] },
        { buyer: usdBuyerLater, obligations: [b] },
        { buyer: eurBuyer, obligations: [c] },
      ],
      sellers
    );

    const touched = await settleProductAdvertisingObligations(
      db as unknown as Db,
      [usdBuyer._id, usdBuyerLater._id, eurBuyer._id],
      20
    );

    for (const [sellerId, total] of expectedSellerTotals([a, b, c])) {
      const paid = await cash(db, new ObjectId(sellerId));
      expect(Math.abs(paid - total)).toBeLessThan(1e-9);
      expect(Math.round(paid * 100)).toBe(Math.round(total * 100));
    }
    expect(await cash(db, usdBuyer._id)).toBeCloseTo(1_000_000 - a.buyerAmountLocal, 9);
    expect(await cash(db, eurBuyer._id)).toBeCloseTo(1_000_000 - c.buyerAmountLocal, 9);
    expect(await poolTotal(db)).toBeLessThan(1e-9);

    const [clearing] = await journalRecords(db, CLEARING);
    expect(clearing.status).toBe("applied");
    // One debit per pool (USD, EUR), each carrying its orders' frozen rates.
    // Credits are one per (seller, currency, frozen rate): the USD-b order
    // froze different seller rates, so each seller has two groups.
    expect(clearing.legs.filter((leg) => leg.kind === "debit")).toHaveLength(2);
    expect(clearing.legs.filter((leg) => leg.kind === "credit")).toHaveLength(10);
    expect(await db.collection(PRODUCT_ADVERTISING_PAYABLES_COLLECTION).countDocuments({})).toBe(0);
    for (const seller of sellers)
      expect(touched.map((id) => id.toHexString())).toContain(seller._id.toHexString());
  });

  it("pays once after a crash between stage 1 and stage 2", async () => {
    const buyer = corp("USD", 1);
    const sellers = [corp("USD", 1), corp("EUR", 0.9), corp("GBP", 0.8), corp("CAD", 1.35)];
    const first = order(buyer, sellers, 50, 30, "first");
    const db = createInMemoryDb();
    seedWorld(db, [{ buyer, obligations: [first] }], sellers);

    // Stage 1 only: the turn dies before clearing.
    await settleProductAdvertisingObligations(db as unknown as Db, [buyer._id], 30, "media", {
      skipClearing: true,
    });
    expect(await cash(db, buyer._id)).toBeCloseTo(1_000_000 - 50, 9);
    for (const seller of sellers) expect(await cash(db, seller._id)).toBe(0);
    expect(await poolTotal(db)).toBeCloseTo(50, 9);

    // The next turn clears the stranded payable, and a further run is a no-op.
    await settleProductAdvertisingObligations(db as unknown as Db, [buyer._id], 31);
    await settleProductAdvertisingObligations(db as unknown as Db, [buyer._id], 32);
    for (const [sellerId, total] of expectedSellerTotals([first]))
      expect(await cash(db, new ObjectId(sellerId))).toBeCloseTo(total, 9);
    expect(await poolTotal(db)).toBeLessThan(1e-9);
    expect(await journalRecords(db, CLEARING)).toHaveLength(1);
  });

  it("resumes a clearing that crashed mid-delivery and pays each seller once", async () => {
    const buyers = [corp("USD", 1), corp("USD", 1)];
    const sellers = Array.from({ length: 8 }, (_, i) =>
      corp((["USD", "EUR", "GBP", "CAD"] as const)[i % 4], [1, 0.9, 0.8, 1.35][i % 4])
    );
    const orders = buyers.map((buyer, i) => order(buyer, sellers, 40 + i, 40, `p${i}`));
    const db = createInMemoryDb();
    seedWorld(
      db,
      buyers.map((buyer, i) => ({ buyer, obligations: [orders[i]] })),
      sellers
    );
    const corporations = db.collection("corporations");
    const realBulkWrite = corporations.bulkWrite.bind(corporations);
    let armed = true;
    corporations.bulkWrite = async (ops) => {
      const result = await realBulkWrite(ops);
      if (armed && ops.length >= 4) {
        armed = false;
        throw new Error("process killed after the seller writes landed");
      }
      return result;
    };

    await expect(
      settleProductAdvertisingObligations(
        db as unknown as Db,
        buyers.map((buyer) => buyer._id),
        40
      )
    ).rejects.toThrow("process killed");
    const [stuck] = await journalRecords(db, CLEARING);
    expect(stuck.status).toBe("partial");

    // Same turn rerun, then a later turn: exactly one payment per seller.
    await settleProductAdvertisingObligations(
      db as unknown as Db,
      buyers.map((buyer) => buyer._id),
      40
    );
    await settleProductAdvertisingObligations(db as unknown as Db, [], 41);
    for (const [sellerId, total] of expectedSellerTotals(orders))
      expect(await cash(db, new ObjectId(sellerId))).toBeCloseTo(total, 9);
    const clearings = await journalRecords(db, CLEARING);
    expect(clearings).toHaveLength(1);
    expect(clearings[0].status).toBe("applied");
    expect(await poolTotal(db)).toBeLessThan(1e-9);
    expect(await db.collection(PRODUCT_ADVERTISING_PAYABLES_COLLECTION).countDocuments({})).toBe(0);
  });

  it("keeps a deferred seller owed across turns and pays it exactly once", async () => {
    const buyer = corp("USD", 1);
    const moved = corp("EUR", 0.9);
    const steady = corp("GBP", 0.8);
    const first = order(buyer, [moved, steady], 60, 50, "first");
    const second = order(buyer, [moved, steady], 30, 51, "second");
    const db = createInMemoryDb();
    seedWorld(db, [{ buyer, obligations: [first, second] }], [moved, steady]);
    await db
      .collection("corporations")
      .updateOne({ _id: moved._id }, { $set: { liquidCurrencyCode: "CAD", countryId: "CA" } });
    const store = db as unknown as Db;
    const totals = expectedSellerTotals([first, second]);
    const movedShare = (o: ProductAdvertisingObligation) =>
      o.sellerAllocations.find((s) => s.corporationId === moved._id.toHexString())!;

    await settleProductAdvertisingObligations(store, [buyer._id], 50);
    expect(await cash(db, steady._id)).toBeCloseTo(
      first.sellerAllocations.find((s) => s.corporationId === steady._id.toHexString())!
        .amountLocal,
      9
    );
    expect(await cash(db, moved._id)).toBe(0);
    // The moved seller's share stays in the pool at the buyer's frozen rate.
    expect(await poolTotal(db)).toBeCloseTo(
      (movedShare(first).amountLocal / movedShare(first).localPerAnchor) *
        first.buyerLocalPerAnchor,
      9
    );

    // Consume the receipt so the second order can settle next turn.
    await db
      .collection("corporations")
      .updateOne({ _id: buyer._id }, { $unset: { mediaProductAdvertisingReceiptV1: "" } });
    await settleProductAdvertisingObligations(store, [buyer._id], 51);
    expect(await cash(db, steady._id)).toBeCloseTo(totals.get(steady._id.toHexString())!, 9);
    expect(await cash(db, moved._id)).toBe(0);

    await db
      .collection("corporations")
      .updateOne({ _id: moved._id }, { $set: { liquidCurrencyCode: "EUR", countryId: "DE" } });
    await settleProductAdvertisingObligations(store, [buyer._id], 52);
    await settleProductAdvertisingObligations(store, [buyer._id], 53);
    expect(await cash(db, moved._id)).toBeCloseTo(totals.get(moved._id.toHexString())!, 9);
    expect(await cash(db, steady._id)).toBeCloseTo(totals.get(steady._id.toHexString())!, 9);
    expect(await poolTotal(db)).toBeLessThan(1e-9);
    expect(await db.collection(PRODUCT_ADVERTISING_PAYABLES_COLLECTION).countDocuments({})).toBe(0);
  });

  it("keeps a clearing refused by a racing guard out of later clearings until it resumes", async () => {
    const buyer = corp("USD", 1);
    const laterBuyer = corp("USD", 1);
    const racer = corp("EUR", 0.9);
    const steady = corp("GBP", 0.8);
    const first = order(buyer, [racer, steady], 40, 60, "first");
    const later = order(laterBuyer, [racer, steady], 20, 61, "later");
    const db = createInMemoryDb();
    seedWorld(
      db,
      [
        { buyer, obligations: [first] },
        { buyer: laterBuyer, obligations: [later] },
      ],
      [racer, steady]
    );
    const store = db as unknown as Db;
    await settleProductAdvertisingObligations(store, [buyer._id], 60, "media", {
      skipClearing: true,
    });
    const owed = (await db
      .collection(PRODUCT_ADVERTISING_PAYABLES_COLLECTION)
      .find({})
      .toArray()) as unknown as ProductAdvertisingPayable[];
    // The seller moves after the eligibility read: the journal guard refuses.
    await db
      .collection("corporations")
      .updateOne({ _id: racer._id }, { $set: { liquidCurrencyCode: "CAD", countryId: "CA" } });
    const raced = await settleTransition(
      store,
      productAdvertisingClearingTransition("media", 60, owed)!
    );
    expect(raced.status).toBe("partial");

    // A later turn clears only the new order; the raced one stays in flight.
    await settleProductAdvertisingObligations(store, [laterBuyer._id], 61);
    const steadyFirst = first.sellerAllocations.find(
      (s) => s.corporationId === steady._id.toHexString()
    )!.amountLocal;
    const steadyLater = later.sellerAllocations.find(
      (s) => s.corporationId === steady._id.toHexString()
    )!.amountLocal;
    // The raced clearing may or may not have reached the steady seller before
    // the refusal stopped it (leg order); either way the later clearing never
    // pays the raced order again.
    const steadyNow = await cash(db, steady._id);
    expect(
      [steadyLater, steadyFirst + steadyLater].some((v) => Math.abs(v - steadyNow) < 1e-9)
    ).toBe(true);
    // Still moved: the later order's share is deferred, the raced one is in flight.
    expect(await cash(db, racer._id)).toBe(0);
    expect(await db.collection(PRODUCT_ADVERTISING_PAYABLES_COLLECTION).countDocuments({})).toBe(2);

    await db
      .collection("corporations")
      .updateOne({ _id: racer._id }, { $set: { liquidCurrencyCode: "EUR", countryId: "DE" } });
    await settleProductAdvertisingObligations(store, [], 62);
    await settleProductAdvertisingObligations(store, [], 63);
    const totals = expectedSellerTotals([first, later]);
    expect(await cash(db, racer._id)).toBeCloseTo(totals.get(racer._id.toHexString())!, 9);
    expect(await cash(db, steady._id)).toBeCloseTo(totals.get(steady._id.toHexString())!, 9);
    expect(await poolTotal(db)).toBeLessThan(1e-9);
    const statuses = (await journalRecords(db, CLEARING)).map((row) => row.status);
    expect(statuses.every((status) => status === "applied")).toBe(true);
  });

  it("resumes an in-flight legacy order through its own per-seller legs", async () => {
    const buyer = corp("USD", 1);
    const seller = corp("EUR", 0.9);
    const legacy = order(buyer, [seller], 25, 70, "legacy");
    const db = createInMemoryDb();
    seedWorld(db, [{ buyer, obligations: [legacy] }], [seller]);
    const store = db as unknown as Db;
    await db
      .collection("corporations")
      .updateOne({ _id: seller._id }, { $set: { liquidCurrencyCode: "CAD", countryId: "CA" } });
    const old = await settleTransition(
      store,
      legacyProductAdvertisingTransition(buyer._id, legacy, "media")
    );
    expect(old.status).toBe("partial");
    await db
      .collection("corporations")
      .updateOne({ _id: seller._id }, { $set: { liquidCurrencyCode: "EUR", countryId: "DE" } });

    const touched = await settleProductAdvertisingObligations(store, [buyer._id], 70);

    expect(await cash(db, seller._id)).toBeCloseTo(legacy.sellerAllocations[0].amountLocal, 9);
    expect(await cash(db, buyer._id)).toBeCloseTo(1_000_000 - 25, 9);
    const [record] = await journalRecords(db, ORDER);
    expect(record.status).toBe("applied");
    expect(record.legs).toHaveLength(2);
    expect(await journalRecords(db, CLEARING)).toHaveLength(0);
    expect(await db.collection(PRODUCT_ADVERTISING_PAYABLES_COLLECTION).countDocuments({})).toBe(0);
    expect(await poolTotal(db)).toBe(0);
    expect(touched.map((id) => id.toHexString())).toContain(seller._id.toHexString());
    expect(
      (await db.collection("corporations").findOne({ _id: buyer._id }))
        ?.mediaProductAdvertisingReceiptV1
    ).toMatchObject({ projectId: "legacy" });
  });

  it("writes legs proportional to orders plus sellers, not orders times sellers", async () => {
    const ORDERS = 141;
    const SELLERS = 486;
    const currencies = [
      ["USD", 1],
      ["EUR", 0.9],
      ["GBP", 0.8],
      ["CAD", 1.35],
    ] as const;
    const sellers = Array.from({ length: SELLERS }, (_, i) =>
      corp(currencies[i % 4][0], currencies[i % 4][1])
    );
    const buyers = Array.from({ length: ORDERS }, (_, i) =>
      corp(currencies[i % 4][0], currencies[i % 4][1])
    );
    const orders = buyers.map((buyer, i) => order(buyer, sellers, 10 + (i % 13), 199, `t${i}`));
    const db = createInMemoryDb();
    seedWorld(
      db,
      buyers.map((buyer, i) => ({ buyer, obligations: [orders[i]] })),
      sellers
    );

    await settleProductAdvertisingObligations(
      db as unknown as Db,
      buyers.map((buyer) => buyer._id),
      199
    );

    const records = (await db.collection("bankMoneyMoves").find({}).toArray()) as Array<{
      kind: string;
      legs: unknown[];
    }>;
    const legs = records.reduce((sum, record) => sum + record.legs.length, 0);
    const legacyLegs = ORDERS * (1 + SELLERS);
    // 2 legs per order, then 4 pool debits and one credit per seller.
    expect(legs).toBe(ORDERS * 2 + currencies.length + SELLERS);
    expect(legacyLegs).toBe(68_667);
    expect(legs).toBeLessThan(legacyLegs / 50);
    for (const [sellerId, total] of expectedSellerTotals(orders)) {
      const paid = await cash(db, new ObjectId(sellerId));
      expect(Math.abs(paid - total)).toBeLessThan(1e-9);
    }
    expect(await poolTotal(db)).toBeLessThan(1e-9);
  });
});
