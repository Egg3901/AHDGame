import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { convertCorpCurrency } from "./convertCorpCurrency";
import type { Corporation, CorporateSector, ShareOrder, ShareListing } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/corporations/cancelShareOrder", () => ({
  cancelShareOrderAndRefund: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/corporations/cancelShareListing", () => ({
  cancelShareListingAndRefund: vi.fn(async () => ({
    ok: true,
    refundedOffers: 0,
    sharesReturned: 0,
  })),
}));
// Transaction path: mock getMongoClient so session.withTransaction runs our
// callback inline. The first branch throws a "transactions not supported"
// error (code 20) to simulate standalone mongod; the helper's catch block
// falls back to sequential writes, which is what these unit tests exercise.
vi.mock("@/lib/mongodb", () => ({
  getMongoClient: vi.fn(async () => ({
    startSession: () => ({
      withTransaction: vi.fn(async () => {
        const err = new Error("transactions not supported on standalone") as Error & {
          code?: number;
        };
        err.code = 20;
        throw err;
      }),
      endSession: vi.fn(async () => {}),
    }),
  })),
  getDb: vi.fn(),
}));

describe("convertCorpCurrency", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  function makeCorp(overrides: Partial<Corporation> = {}): Corporation {
    return {
      _id: new ObjectId(),
      name: "TestCo",
      liquidCurrencyCode: "JPY",
      countryId: "JP",
      liquidCapital: 10_000_000, // 10M JPY
      sharePrice: 500, // 500 JPY/share
      marketingBudget: 500_000, // 500K JPY/turn
      logisticsBudget: 250_000, // 250K JPY/turn
      ceoSalary: 100_000, // 100K JPY/turn
      totalShares: 10_000_000,
      ...overrides,
    } as Corporation;
  }

  function fxMap(entries: [CurrencyCode, number][]): ReadonlyMap<CurrencyCode, number> {
    return new Map(entries);
  }

  it("no-op when source and target currencies match", async () => {
    const corp = makeCorp({ liquidCurrencyCode: "JPY" });
    const rates = fxMap([
      ["JPY", 130],
      ["GBP", 0.8],
    ]);
    const result = await convertCorpCurrency(
      db as unknown as Db,
      corp,
      "JPY",
      rates,
      new Date(),
      true
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.converted).toBe(false);
    expect(db.collectionMocks.corporations).toBeUndefined();
  });

  it("scales every corp money field by toRate / fromRate (JPY → GBP)", async () => {
    const corp = makeCorp({ liquidCurrencyCode: "JPY" });
    // 130 JPY / ₳, 0.8 GBP / ₳ → scale = 0.8 / 130 ≈ 0.006154
    const rates = fxMap([
      ["JPY", 130],
      ["GBP", 0.8],
    ]);
    const now = new Date();
    const result = await convertCorpCurrency(db as unknown as Db, corp, "GBP", rates, now, true);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.converted).toBe(true);
    expect(result.fromCurrency).toBe("JPY");
    expect(result.toCurrency).toBe("GBP");
    expect(result.scale).toBeCloseTo(0.8 / 130, 6);

    const corpsUpdateOne = db.collectionMocks.corporations!.updateOne;
    expect(corpsUpdateOne).toHaveBeenCalledTimes(1);
    const setPayload = corpsUpdateOne.mock.calls[0]![1].$set as Record<string, unknown>;
    expect(setPayload.liquidCurrencyCode).toBe("GBP");
    // 10M JPY × (0.8/130) = 61,538.46 GBP
    expect(setPayload.liquidCapital).toBeCloseTo(61_538.46, 1);
    // 500 JPY/share × scale ≈ 3.0769 GBP/share
    expect(setPayload.sharePrice).toBeCloseTo(3.0769, 3);
    expect(setPayload.marketingBudget).toBeCloseTo(500_000 * (0.8 / 130), 1);
    expect(setPayload.logisticsBudget).toBeCloseTo(250_000 * (0.8 / 130), 1);
    expect(setPayload.ceoSalary).toBeCloseTo(100_000 * (0.8 / 130), 1);
    expect(setPayload.updatedAt).toEqual(now);
  });

  it("converts each sector's revenue + currentGrowthCost via bulkWrite", async () => {
    const corp = makeCorp();
    const sectorA: CorporateSector = {
      _id: new ObjectId(),
      corporationId: corp._id,
      revenue: 1_000_000, // JPY/turn
      currentGrowthCost: 50_000,
    } as CorporateSector;
    const sectorB: CorporateSector = {
      _id: new ObjectId(),
      corporationId: corp._id,
      revenue: 2_500_000,
      currentGrowthCost: 75_000,
    } as CorporateSector;
    db.collectionMocks.corporateSectors = db.collection("corporateSectors") as never;
    db.collectionMocks.corporateSectors!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([sectorA, sectorB]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    // matchedCount must equal the number of sectors so the integrity check passes.
    db.collectionMocks.corporateSectors!.bulkWrite.mockResolvedValue({
      modifiedCount: 2,
      matchedCount: 2,
    });
    const rates = fxMap([
      ["JPY", 130],
      ["GBP", 0.8],
    ]);

    const result = await convertCorpCurrency(
      db as unknown as Db,
      corp,
      "GBP",
      rates,
      new Date(),
      true
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.sectorsConverted).toBe(2);
    const bulkCall = db.collectionMocks.corporateSectors!.bulkWrite.mock.calls[0]![0];
    // Both sectors rescaled by scale = 0.8/130
    const opA = bulkCall[0].updateOne.update.$set;
    const opB = bulkCall[1].updateOne.update.$set;
    expect(opA.revenue).toBeCloseTo(1_000_000 * (0.8 / 130), 1);
    expect(opA.currentGrowthCost).toBeCloseTo(50_000 * (0.8 / 130), 2);
    expect(opB.revenue).toBeCloseTo(2_500_000 * (0.8 / 130), 1);
    expect(opB.currentGrowthCost).toBeCloseTo(75_000 * (0.8 / 130), 2);
  });

  it("throws and captures Sentry error when bulkWrite matchedCount < sector count", async () => {
    const Sentry = await import("@sentry/nextjs");
    const corp = makeCorp();
    const sector: CorporateSector = {
      _id: new ObjectId(),
      corporationId: corp._id,
      revenue: 1_000_000,
      currentGrowthCost: 50_000,
    } as CorporateSector;
    db.collectionMocks.corporateSectors = db.collection("corporateSectors") as never;
    db.collectionMocks.corporateSectors!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([sector]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    // Simulate partial failure: 1 sector fetched but 0 matched.
    db.collectionMocks.corporateSectors!.bulkWrite.mockResolvedValue({
      modifiedCount: 0,
      matchedCount: 0,
    });
    const rates = fxMap([
      ["JPY", 130],
      ["GBP", 0.8],
    ]);

    await expect(
      convertCorpCurrency(db as unknown as Db, corp, "GBP", rates, new Date(), true)
    ).rejects.toThrow(/sector count mismatch/);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it("cancels open share orders and listings before converting (ordering matters)", async () => {
    const corp = makeCorp();
    const order1: ShareOrder = {
      _id: new ObjectId(),
      corporationId: corp._id,
      status: "open",
    } as ShareOrder;
    const listing1: ShareListing = {
      _id: new ObjectId(),
      corporationId: corp._id,
      status: "open",
    } as ShareListing;

    db.collectionMocks.shareOrders = db.collection("shareOrders") as never;
    db.collectionMocks.shareOrders!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([order1]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    db.collectionMocks.shareListings = db.collection("shareListings") as never;
    db.collectionMocks.shareListings!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([listing1]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    const { cancelShareOrderAndRefund } = await import("@/lib/corporations/cancelShareOrder");
    const { cancelShareListingAndRefund } = await import("@/lib/corporations/cancelShareListing");
    const rates = fxMap([
      ["JPY", 130],
      ["GBP", 0.8],
    ]);

    const result = await convertCorpCurrency(
      db as unknown as Db,
      corp,
      "GBP",
      rates,
      new Date(),
      true
    );

    expect(cancelShareOrderAndRefund).toHaveBeenCalledTimes(1);
    expect(cancelShareListingAndRefund).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.ordersCancelled).toBe(1);
    expect(result.listingsCancelled).toBe(1);
    // Ensure the corporations $set came AFTER the cancel calls (order integrity).
    const corpsUpdateOrder = db.collectionMocks.corporations!.updateOne.mock.invocationCallOrder[0];
    const cancelOrderOrder = (cancelShareOrderAndRefund as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    expect(cancelOrderOrder).toBeLessThan(corpsUpdateOrder!);
  });

  it("pre-forex corp (no liquidCurrencyCode) is treated as ₳ source (rate=1)", async () => {
    const corp = makeCorp({ liquidCurrencyCode: undefined, countryId: undefined } as never);
    // Missing fromRate → default 1.0. target GBP rate = 0.8 → scale = 0.8.
    const rates = fxMap([
      ["USD", 1.04],
      ["GBP", 0.8],
    ]);
    const result = await convertCorpCurrency(
      db as unknown as Db,
      corp,
      "GBP",
      rates,
      new Date(),
      true
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.converted).toBe(true);
    expect(result.fromCurrency).toBeUndefined();
    expect(result.toCurrency).toBe("GBP");
    expect(result.scale).toBeCloseTo(0.8, 6);
    const setPayload = db.collectionMocks.corporations!.updateOne.mock.calls[0]![1].$set as Record<
      string,
      unknown
    >;
    expect(setPayload.liquidCurrencyCode).toBe("GBP");
    expect(setPayload.liquidCapital).toBeCloseTo(10_000_000 * 0.8, 1);
  });

  it("USD → JPY conversion (ascending FX rate) scales values up", async () => {
    const corp = makeCorp({
      liquidCurrencyCode: "USD",
      countryId: "US",
      liquidCapital: 100_000, // 100K USD
      sharePrice: 10,
    });
    const rates = fxMap([
      ["USD", 1.04],
      ["JPY", 130],
    ]);
    const result = await convertCorpCurrency(
      db as unknown as Db,
      corp,
      "JPY",
      rates,
      new Date(),
      true
    );
    // scale = 130 / 1.04 = 125
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.scale).toBeCloseTo(125, 4);
    const setPayload = db.collectionMocks.corporations!.updateOne.mock.calls[0]![1].$set as Record<
      string,
      unknown
    >;
    expect(setPayload.liquidCapital).toBeCloseTo(12_500_000, 1);
    expect(setPayload.sharePrice).toBeCloseTo(1_250, 2);
  });

  it("missing target FX rate returns rateUnavailable error (no mutation)", async () => {
    const corp = makeCorp({ liquidCurrencyCode: "JPY" });
    // EUR not in the map
    const rates = fxMap([["JPY", 130]]);
    const result = await convertCorpCurrency(
      db as unknown as Db,
      corp,
      "EUR",
      rates,
      new Date(),
      true
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.rateUnavailable).toBe(true);
    expect(result.error).toContain("EUR");
    // Crucially: no corp write happened.
    expect(db.collectionMocks.corporations).toBeUndefined();
  });

  it("order cancel failure aborts conversion (no corp or sector writes)", async () => {
    const { cancelShareOrderAndRefund } = await import("@/lib/corporations/cancelShareOrder");
    vi.mocked(cancelShareOrderAndRefund).mockResolvedValueOnce({
      ok: false,
      error: "Exchange rate unavailable, try again shortly",
    });
    const corp = makeCorp();
    db.collectionMocks.shareOrders = db.collection("shareOrders") as never;
    db.collectionMocks.shareOrders!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: new ObjectId(), corporationId: corp._id, status: "open" }]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    const rates = fxMap([
      ["JPY", 130],
      ["GBP", 0.8],
    ]);
    const result = await convertCorpCurrency(
      db as unknown as Db,
      corp,
      "GBP",
      rates,
      new Date(),
      true
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.rateUnavailable).toBe(true);
    // The failure aborts before corp and sector writes.
    expect(db.collectionMocks.corporations).toBeUndefined();
    expect(db.collectionMocks.corporateSectors).toBeUndefined();
  });

  it("transaction success path: corp + sectors commit via withTransaction", async () => {
    // Override the default mock (which throws code=20) with one that actually
    // runs the callback — simulating a replica-set deployment.
    const { getMongoClient } = await import("@/lib/mongodb");
    const withTransactionSpy = vi.fn(async (cb: (...args: unknown[]) => Promise<unknown>) => cb());
    const endSessionSpy = vi.fn(async () => {});
    vi.mocked(getMongoClient).mockResolvedValueOnce({
      startSession: () => ({
        withTransaction: withTransactionSpy,
        endSession: endSessionSpy,
      }),
    } as any);

    const corp = makeCorp();
    const rates = fxMap([
      ["JPY", 130],
      ["GBP", 0.8],
    ]);
    const result = await convertCorpCurrency(
      db as unknown as Db,
      corp,
      "GBP",
      rates,
      new Date(),
      true
    );
    expect(result.ok).toBe(true);
    expect(withTransactionSpy).toHaveBeenCalledTimes(1);
    expect(endSessionSpy).toHaveBeenCalledTimes(1);
    // Writes happened inside the transaction callback.
    expect(db.collectionMocks.corporations!.updateOne).toHaveBeenCalledTimes(1);
  });

  it("omits ceoSalary $set when corp had no ceoSalary field", async () => {
    const corp = makeCorp({ ceoSalary: undefined } as never);
    const rates = fxMap([
      ["JPY", 130],
      ["GBP", 0.8],
    ]);
    const result = await convertCorpCurrency(
      db as unknown as Db,
      corp,
      "GBP",
      rates,
      new Date(),
      true
    );
    expect(result.ok).toBe(true);
    const setPayload = db.collectionMocks.corporations!.updateOne.mock.calls[0]![1].$set as Record<
      string,
      unknown
    >;
    expect("ceoSalary" in setPayload).toBe(false);
  });
});
