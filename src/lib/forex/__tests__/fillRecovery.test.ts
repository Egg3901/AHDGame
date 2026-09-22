/**
 * Crash-injection tests for durable forex peer fills.
 *
 * Each test kills the sequential fill at an exact write, then runs recovery
 * and asserts the property that matters on a database without transactions:
 * money never moves twice, and whatever the crash left half done is either
 * finished by the retry or visibly rolled back. Never silently lost, never
 * minted, never frozen.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { InjectedCrash, withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { calculateSpreadFee } from "@/lib/currency/spreadFees";
import { getCountryForCurrency } from "@/lib/currency/marketMaker";
import { getBankId } from "@/lib/centralBank/helpers";
import { LIMIT_ORDER_SPREAD } from "@/lib/constants/currencies";
import type { ProcessingFillIntent } from "@/lib/db/types/currencyOrder";
import {
  applyCancelRefund,
  applyFillLegs,
  buildFillIntent,
  cancelClaimKey,
  claimFillWithIntent,
  fillClaimKey,
  isFillClaimStale,
  recoverFillClaim,
  recoverStaleFillClaims,
} from "@/lib/forex/fillRecovery";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));

const FILLER = new ObjectId();
const POSTER = new ObjectId();
const ORDER = new ObjectId();
const TURN = 51;
const RATE = 0.8;
const FILL_AMOUNT = 1000;

const HALF_SPREAD = LIMIT_ORDER_SPREAD / 2;
const POSTER_SPREAD = calculateSpreadFee(FILL_AMOUNT, HALF_SPREAD);
const TO_AMOUNT = FILL_AMOUNT * RATE;
const FILLER_SPREAD = calculateSpreadFee(TO_AMOUNT, HALF_SPREAD);
const FILLER_COST = TO_AMOUNT + FILLER_SPREAD;
const FILLER_CREDIT = FILL_AMOUNT - POSTER_SPREAD;

const STALE_NOW = new Date("2026-09-01T12:10:00Z");
const STALE_CLAIMED_AT = new Date("2026-09-01T12:00:00Z");

function world(): InMemoryDb {
  const db = createInMemoryDb();
  db.seed("characters", [
    {
      _id: FILLER,
      currencyBalances: { personal: { USD: 5000, GBP: 50000 } },
    },
    {
      _id: POSTER,
      currencyBalances: { personal: { USD: 1000, GBP: 2000 } },
    },
  ]);
  db.seed("currencyOrders", [
    {
      _id: ORDER,
      type: "limit",
      status: "open",
      characterId: POSTER,
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: FILL_AMOUNT,
      filledAmount: 0,
      limitRate: RATE,
      spreadCharged: 0,
      createdAt: new Date("2026-09-01T11:00:00Z"),
      updatedAt: new Date("2026-09-01T11:00:00Z"),
    },
  ]);
  db.seed("centralBanks", [
    { _id: getBankId("US"), forexRevenue: 0 },
    { _id: getBankId("UK"), forexRevenue: 0 },
  ]);
  return db;
}

function intent(nonce = "test-nonce", claimedAt: Date = STALE_CLAIMED_AT): ProcessingFillIntent {
  const fromCountry = getCountryForCurrency("USD");
  const toCountry = getCountryForCurrency("GBP");
  if (!fromCountry || !toCountry) throw new Error("test currencies must resolve countries");
  return buildFillIntent({
    orderId: ORDER,
    fillerId: FILLER,
    posterId: POSTER,
    statusBefore: "open",
    filledAmountBefore: 0,
    fillAmount: FILL_AMOUNT,
    newFilledAmount: FILL_AMOUNT,
    newStatus: "filled",
    fromCurrency: "USD",
    toCurrency: "GBP",
    toCurrencyAmount: TO_AMOUNT,
    posterSpread: POSTER_SPREAD,
    fillerSpread: FILLER_SPREAD,
    fillerTotalCost: FILLER_COST,
    spreadTuples: [
      { fee: POSTER_SPREAD, source: fromCountry, currency: "USD", dest: toCountry },
      { fee: FILLER_SPREAD, source: toCountry, currency: "GBP", dest: fromCountry },
    ],
    rate: RATE,
    turn: TURN,
    now: claimedAt,
    nonce,
  });
}

function balances(db: InMemoryDb) {
  const docs = db.collection("characters").docs as Array<{
    _id: ObjectId;
    currencyBalances: { personal: Record<string, number> };
  }>;
  const byId = new Map(docs.map((d) => [d._id.toHexString(), d.currencyBalances.personal]));
  return {
    filler: byId.get(FILLER.toHexString())!,
    poster: byId.get(POSTER.toHexString())!,
  };
}

function orderDoc(db: InMemoryDb) {
  return db.collection("currencyOrders").docs[0] as unknown as {
    status: string;
    filledAmount: number;
    processingFillKey?: string;
    processingFill?: ProcessingFillIntent;
  };
}

function bankDocs(db: InMemoryDb) {
  const docs = db.collection("centralBanks").docs as Array<{
    _id: string;
    forexRevenue: number;
    spreadFeeReserveBalances?: Record<string, number>;
  }>;
  return new Map(docs.map((d) => [String(d._id), d]));
}

async function crashFill(
  memory: InMemoryDb,
  plan: Parameters<typeof withInjectedCrash>[1]
): Promise<ProcessingFillIntent> {
  const claim = intent();
  await claimFillWithIntent(
    memory as unknown as Db,
    { _id: ORDER, status: { $in: ["open", "partial"] }, filledAmount: 0 },
    claim,
    STALE_CLAIMED_AT
  );
  const faulty = withInjectedCrash(memory, plan);
  await expect(applyFillLegs(faulty.db, claim, STALE_NOW)).rejects.toBeInstanceOf(InjectedCrash);
  faulty.disarm();
  return claim;
}

describe("forex fill crash recovery", () => {
  let memory: InMemoryDb;
  beforeEach(() => {
    vi.clearAllMocks();
    memory = world();
  });

  it("builds a stable claim key from the pre-fill state", () => {
    expect(fillClaimKey(ORDER.toHexString(), 0)).toBe(`forex-fill:${ORDER.toHexString()}:0`);
    expect(intent().key).toBe(fillClaimKey(ORDER.toHexString(), 0));
  });

  it("crash after filler debit: recovery completes the fill exactly once", async () => {
    const claim = await crashFill(memory, {
      collection: "characters",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
    });

    const result = await recoverFillClaim(memory as unknown as Db, ORDER, STALE_NOW);
    expect(result).toEqual({
      outcome: "completed",
      fillAmount: FILL_AMOUNT,
      orderStatus: "filled",
    });

    const { filler, poster } = balances(memory);
    expect(filler.GBP).toBe(50000 - FILLER_COST);
    expect(filler.USD).toBe(5000 + FILLER_CREDIT);
    expect(poster.GBP).toBe(2000 + TO_AMOUNT);
    expect(poster.USD).toBe(1000);

    const order = orderDoc(memory);
    expect(order.status).toBe("filled");
    expect(order.filledAmount).toBe(FILL_AMOUNT);
    expect(order.processingFillKey).toBeUndefined();

    const history = memory.collection("tradeHistory").docs;
    expect(history).toHaveLength(1);
    expect(history[0]._id).toBe(claim.key);

    // Spread collected exactly once per leg: revenue to the source bank,
    // reserve slice to the destination bank, in the collected currency.
    const banks = bankDocs(memory);
    expect(banks.get(getBankId("US"))!.forexRevenue).toBe(1);
    expect(banks.get(getBankId("US"))!.spreadFeeReserveBalances?.["GBP"]).toBe(2);
    expect(banks.get(getBankId("UK"))!.forexRevenue).toBe(1);
    expect(banks.get(getBankId("UK"))!.spreadFeeReserveBalances?.["USD"]).toBe(2);

    // A second recovery is a no-op, not a second fill.
    const replay = await recoverFillClaim(memory as unknown as Db, ORDER, STALE_NOW);
    expect(replay).toEqual({ outcome: "nothing-to-do" });
    expect(balances(memory).filler.GBP).toBe(50000 - FILLER_COST);
    expect(memory.collection("tradeHistory").docs).toHaveLength(1);
  });

  it("crash after all money legs before the final flip: replay completes without double-credit", async () => {
    // Crash between the spread legs and the history insert: all money moved,
    // flip and history missing. The injected throw surfaces as a leg failure
    // (not a crash exception) because the applier maps insert errors to results.
    const claim = intent();
    await claimFillWithIntent(
      memory as unknown as Db,
      { _id: ORDER, status: { $in: ["open", "partial"] }, filledAmount: 0 },
      claim,
      STALE_CLAIMED_AT
    );
    const faulty = withInjectedCrash(memory, {
      collection: "tradeHistory",
      op: "insertOne",
      onCall: 1,
    });
    const interrupted = await applyFillLegs(faulty.db, claim, STALE_NOW);
    expect(interrupted.ok).toBe(false);
    faulty.disarm();

    const result = await recoverFillClaim(memory as unknown as Db, ORDER, STALE_NOW);
    expect(result.outcome).toBe("completed");

    const { filler, poster } = balances(memory);
    expect(filler.GBP).toBe(50000 - FILLER_COST);
    expect(poster.GBP).toBe(2000 + TO_AMOUNT);
    expect(orderDoc(memory).status).toBe("filled");
    expect(memory.collection("tradeHistory").docs).toHaveLength(1);
  });

  it("crash before any leg: recovery rolls back and the order returns to the book", async () => {
    await crashFill(memory, { collection: "characters", op: "updateOne", onCall: 1 });

    const result = await recoverFillClaim(memory as unknown as Db, ORDER, STALE_NOW);
    expect(result).toEqual({ outcome: "rolled-back" });

    const { filler, poster } = balances(memory);
    expect(filler).toEqual({ USD: 5000, GBP: 50000 });
    expect(poster).toEqual({ USD: 1000, GBP: 2000 });

    const order = orderDoc(memory);
    expect(order.status).toBe("open");
    expect(order.filledAmount).toBe(0);
    expect(order.processingFillKey).toBeUndefined();
    expect(memory.collection("tradeHistory").docs).toHaveLength(0);

    // A fresh fill can claim the restored order with a new intent.
    const retry = intent("retry-nonce", new Date("2026-09-01T12:20:00Z"));
    const claimed = await claimFillWithIntent(
      memory as unknown as Db,
      { _id: ORDER, status: { $in: ["open", "partial"] }, filledAmount: 0 },
      retry,
      new Date("2026-09-01T12:20:00Z")
    );
    expect(claimed).not.toBeNull();
    const applied = await applyFillLegs(
      memory as unknown as Db,
      retry,
      new Date("2026-09-01T12:20:00Z")
    );
    expect(applied).toEqual({ ok: true, flipWon: true });
    expect(balances(memory).filler.GBP).toBe(50000 - FILLER_COST);
  });

  it("a fresh processing claim is never stolen", async () => {
    const freshNow = new Date("2026-09-01T12:00:30Z");
    const claim = intent("fresh-nonce", new Date("2026-09-01T12:00:00Z"));
    await claimFillWithIntent(
      memory as unknown as Db,
      { _id: ORDER, status: { $in: ["open", "partial"] }, filledAmount: 0 },
      claim,
      claim.claimedAt
    );

    expect(isFillClaimStale(orderDoc(memory) as never, freshNow.getTime())).toBe(false);
    const result = await recoverFillClaim(memory as unknown as Db, ORDER, freshNow);
    expect(result).toEqual({ outcome: "live-claim" });

    // Nothing moved and the claim is intact.
    expect(balances(memory).filler).toEqual({ USD: 5000, GBP: 50000 });
    expect(orderDoc(memory).processingFillKey).toBe(claim.key);

    // A concurrent fill still loses the claim race, as before.
    const racer = await claimFillWithIntent(
      memory as unknown as Db,
      { _id: ORDER, status: { $in: ["open", "partial"] }, filledAmount: 0 },
      intent("racer-nonce", freshNow),
      freshNow
    );
    expect(racer).toBeNull();
  });

  it("poster gone after the filler paid: recovery reverses the debit and restores the order", async () => {
    const claim = intent();
    await claimFillWithIntent(
      memory as unknown as Db,
      { _id: ORDER, status: { $in: ["open", "partial"] }, filledAmount: 0 },
      claim,
      STALE_CLAIMED_AT
    );
    // Poster account deleted mid-fill: the credit can never land.
    await (memory as unknown as Db).collection("characters").deleteOne({ _id: POSTER });

    const result = await recoverFillClaim(memory as unknown as Db, ORDER, STALE_NOW);
    expect(result).toEqual({ outcome: "rolled-back" });

    // Filler made whole, order back on the book (ownerless; expiry handles it).
    expect(balances(memory).filler).toEqual({ USD: 5000, GBP: 50000 });
    expect(orderDoc(memory).status).toBe("open");
    expect(memory.collection("tradeHistory").docs).toHaveLength(0);
  });

  it("filler deleted after paying: recovery restores the order without minting to the poster", async () => {
    // Crash right after the filler debit, then the filler account is deleted.
    // The debit is no longer demonstrable, so completing would mint value to
    // the poster from nothing: recovery restores instead.
    await crashFill(memory, {
      collection: "characters",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
    });
    await (memory as unknown as Db).collection("characters").deleteOne({ _id: FILLER });

    const result = await recoverFillClaim(memory as unknown as Db, ORDER, STALE_NOW);
    expect(result).toEqual({ outcome: "rolled-back" });
    expect(orderDoc(memory).status).toBe("open");
    expect(balances(memory).poster).toEqual({ USD: 1000, GBP: 2000 });
    expect(memory.collection("tradeHistory").docs).toHaveLength(0);
  });

  it("corrupt intent: key mismatch stays visible, never force-completed", async () => {
    const claim = intent();
    await claimFillWithIntent(
      memory as unknown as Db,
      { _id: ORDER, status: { $in: ["open", "partial"] }, filledAmount: 0 },
      claim,
      STALE_CLAIMED_AT
    );
    await (memory as unknown as Db)
      .collection("currencyOrders")
      .updateOne({ _id: ORDER }, { $set: { processingFillKey: "forex-fill:tampered:0" } });

    const result = await recoverFillClaim(memory as unknown as Db, ORDER, STALE_NOW);
    expect(result.outcome).toBe("unresolvable");
    expect(orderDoc(memory).status).toBe("processing");
  });

  it("all legs landed but the flip refuses: unresolvable, never force-completed", async () => {
    const claim = intent();
    await claimFillWithIntent(
      memory as unknown as Db,
      { _id: ORDER, status: { $in: ["open", "partial"] }, filledAmount: 0 },
      claim,
      STALE_CLAIMED_AT
    );
    const applied = await applyFillLegs(memory as unknown as Db, claim, STALE_CLAIMED_AT);
    expect(applied).toEqual({ ok: true, flipWon: true });
    // Contradictory state: everything landed, yet the order is back in
    // processing with a filledAmount no flip guard accepts.
    await (memory as unknown as Db).collection("currencyOrders").updateOne(
      { _id: ORDER },
      {
        $set: {
          status: "processing",
          filledAmount: 400,
          processingFillKey: claim.key,
          processingFill: claim,
        },
      }
    );

    const result = await recoverFillClaim(memory as unknown as Db, ORDER, STALE_NOW);
    expect(result.outcome).toBe("unresolvable");
    expect(orderDoc(memory).status).toBe("processing");
    // No second credit: balances reflect exactly one fill.
    expect(balances(memory).poster.GBP).toBe(2000 + TO_AMOUNT);
  });

  it("sweeper recovers stale intents and leaves fresh ones alone", async () => {
    const stale = intent("stale-nonce");
    await claimFillWithIntent(
      memory as unknown as Db,
      { _id: ORDER, status: { $in: ["open", "partial"] }, filledAmount: 0 },
      stale,
      STALE_CLAIMED_AT
    );

    const freshOrder = new ObjectId();
    memory.collection("currencyOrders").docs.push({
      _id: freshOrder,
      type: "limit",
      status: "processing",
      characterId: POSTER,
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: 10,
      filledAmount: 0,
      limitRate: RATE,
      spreadCharged: 0,
      processingFillKey: "forex-fill:fresh:0",
      processingFill: { ...stale, key: "forex-fill:fresh:0", claimedAt: new Date() },
    } as never);

    // Nothing landed on the stale order, so recovery restores rather than
    // completes; the fresh order is untouched.
    const summary = await recoverStaleFillClaims(memory as unknown as Db, STALE_NOW);
    expect(summary.completed).toHaveLength(0);
    expect(summary.rolledBack).toHaveLength(1);
    expect(summary.unresolvable).toHaveLength(0);
    const fresh = memory
      .collection("currencyOrders")
      .docs.find((d) => (d._id as ObjectId).equals(freshOrder));
    expect((fresh as unknown as { processingFillKey: string }).processingFillKey).toBe(
      "forex-fill:fresh:0"
    );
  });

  it("cancel refunds are stamped: a retried refund pays once", async () => {
    const key = cancelClaimKey(ORDER.toHexString());
    const first = await applyCancelRefund(memory as unknown as Db, POSTER, "USD", 400, key);
    const second = await applyCancelRefund(memory as unknown as Db, POSTER, "USD", 400, key);
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(balances(memory).poster.USD).toBe(1000 + 400);
  });
});
