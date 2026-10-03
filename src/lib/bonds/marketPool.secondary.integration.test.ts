/** Secondary bond cash uses the actual pooled counterparty, including refunds. */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { resetLedgerShadowFlagCache } from "@/lib/ledger/featureFlag";
import { writeBalanceSnapshot, writePreForexBalanceCheckpoint } from "@/lib/ledger/balanceSnapshot";
import { reconcileTurn } from "@/lib/ledger/reconcile";
import type { Bond, IndexFund, NPP } from "@/lib/db/types";
import {
  creditBondPool,
  debitBondPoolGated,
  debitBondPoolUpTo,
  refundBondPoolDebit,
} from "./marketPool";
import { withBondPoolLedgerSnapshot } from "./marketPoolLedger";
import { nppBuyBond } from "@/lib/nppAutonomy/v3/finance/nppBonds";
import {
  purchaseBondUnitsForFund,
  planBondUnitsForFund,
  settleBondPurchasesInTransaction,
  recordSettledBondPurchase,
} from "./purchaseBondUnitsForFund";
import { emitTxBulk, type TxInput } from "@/lib/financialTxLog/emit";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const nativeEnabled = process.env.AHD_POOL_SECONDARY_REAL_MONGO === "1";
let client: MongoClient | undefined;
afterAll(async () => {
  await client?.close();
});
beforeEach(() => {
  resetLedgerShadowFlagCache();
});

async function world(native: boolean, currency: "USD" | "GBP" = "USD", enabled = true) {
  let db: Db;
  if (native) {
    const uri = new URL(process.env.AHD_POOL_SECONDARY_MONGO_URI ?? "mongodb://127.0.0.1:27018");
    if (
      uri.protocol !== "mongodb:" ||
      !["127.0.0.1", "localhost"].includes(uri.hostname) ||
      !["27018", "27020"].includes(uri.port) ||
      uri.username ||
      uri.password ||
      (uri.pathname && uri.pathname !== "/") ||
      uri.search
    )
      throw new Error("Native pool fixtures require a local sandbox endpoint");
    client ??= await MongoClient.connect(uri.toString(), { maxPoolSize: 1, monitorCommands: true });
    db = client.db(`ahd_sim_fixture_pool_secondary_${randomUUID().replaceAll("-", "")}`);
  } else db = createInMemoryDb() as unknown as Db;
  const rate = currency === "GBP" ? 2 : 1;
  await db
    .collection<{ _id: string; ledgerShadow: boolean }>("gameConfig")
    .insertOne({ _id: "default", ledgerShadow: enabled });
  await db
    .collection<{ _id: string; currentTurn: number; preset: string }>("gameState")
    .insertOne({ _id: "current", currentTurn: 1, preset: "1991-default" });
  await db.collection("exchangeRates").insertOne({ currencyCode: currency, rate });
  await db
    .collection<{ _id: string; cashLocal: number; targetCashLocal: number }>("bondMarketPools")
    .insertOne({ _id: currency, cashLocal: 10000, targetCashLocal: 10000 });
  vi.mocked(getDb).mockResolvedValue(db);
  return { db, currency, rate };
}
async function close(db: Db) {
  await writePreForexBalanceCheckpoint(db, 2);
  await writeBalanceSnapshot(db, 2);
  const report = await reconcileTurn(db, 2);
  expect(report?.stockVsFlow.skipped).toBe(false);
  expect(report?.stockVsFlow.divergentCount).toBe(0);
  expect(report?.trialBalance.status).toBe("green");
  expect(report?.unattributed).toEqual([]);
  return report;
}
function bond(currency: "USD" | "GBP"): Bond {
  return {
    _id: new ObjectId(),
    issuerType: "sovereign",
    issuerName: "Fixture issuer",
    countryId: currency === "GBP" ? "UK" : "US",
    currencyCode: currency,
    faceValue: 1000,
    marketPrice: 1,
    couponRate: 5,
    publicFloat: 1000,
    totalIssued: 1000000,
    maturityTurn: 100,
    matured: false,
    defaulted: false,
    holders: [],
  } as unknown as Bond;
}

for (const native of [false, true]) {
  describe.skipIf(native && !nativeEnabled)(
    `secondary pool witnesses (${native ? "native Mongo" : "memory"})`,
    () => {
      it.each(["USD", "GBP"] as const)(
        "records rounded purchases and sales in %s",
        async (currency) => {
          const { db, rate } = await world(native, currency);
          await writeBalanceSnapshot(db, 1);
          await withBondPoolLedgerSnapshot(db, 2, async () => {
            await creditBondPool(db, currency, 100.126, "purchasesIn");
            expect((await debitBondPoolGated(db, currency, 40.121, "salesOut")).ok).toBe(true);
          });
          expect(
            (
              await db
                .collection<{ _id: string; cashLocal: number }>("bondMarketPools")
                .findOne({ _id: currency })
            )?.cashLocal
          ).toBeCloseTo(10060.01, 6);
          const report = await close(db);
          expect(report?.entriesChecked).toBe(2);
          const legs = await db.collection("ledgerEntries").find({ turn: 2 }).toArray();
          expect(legs[0].legs[0].anchorAmount).toBeCloseTo(100.13 / rate, 8);
        }
      );
      it.skipIf(!native)(
        "nets a stamped debit and refund once; refuses duplicate and missing-target refunds",
        async () => {
          const { db } = await world(native);
          await writeBalanceSnapshot(db, 1);
          await withBondPoolLedgerSnapshot(db, 2, async () => {
            expect(
              (
                await debitBondPoolGated(db, "USD", 30, "salesOut", new Date(), {
                  stamp: "sale-once",
                })
              ).ok
            ).toBe(true);
            expect(
              (
                await debitBondPoolGated(db, "USD", 30, "salesOut", new Date(), {
                  stamp: "sale-once",
                })
              ).ok
            ).toBe(false);
            await refundBondPoolDebit(db, "USD", 30, "salesOut", new Date(), {
              stamp: "sale-once",
            });
            await refundBondPoolDebit(db, "USD", 30, "salesOut", new Date(), {
              stamp: "sale-once",
            });
            await refundBondPoolDebit(db, "GBP", 30, "salesOut");
          });
          expect(
            (
              await db
                .collection<{ _id: string; cashLocal: number }>("bondMarketPools")
                .findOne({ _id: "USD" })
            )?.cashLocal
          ).toBe(10000);
          expect((await close(db))?.entriesChecked).toBe(2);
        }
      );
      it("witnesses the exact partial fill without inventing refused or zero cash", async () => {
        const { db } = await world(native);
        await writeBalanceSnapshot(db, 1);
        await withBondPoolLedgerSnapshot(db, 2, async () => {
          expect((await debitBondPoolGated(db, "USD", 10001, "salesOut")).ok).toBe(false);
          await debitBondPoolGated(db, "USD", 0, "salesOut");
          await creditBondPool(db, "USD", 0, "purchasesIn");
          expect(await debitBondPoolUpTo(db, "USD", 20000, "salesOut")).toBe(10000);
        });
        expect((await close(db))?.entriesChecked).toBe(1);
      });
      it("preserves disabled shadow accounting and actual cash outcomes", async () => {
        const { db } = await world(native, "USD", false);
        await withBondPoolLedgerSnapshot(db, 2, async () => {
          await creditBondPool(db, "USD", 100, "purchasesIn");
          await debitBondPoolGated(db, "USD", 30, "salesOut");
          await refundBondPoolDebit(db, "USD", 30, "salesOut");
        });
        expect(
          (
            await db
              .collection<{ _id: string; cashLocal: number }>("bondMarketPools")
              .findOne({ _id: "USD" })
          )?.cashLocal
        ).toBe(10100);
        expect(await db.collection("ledgerEntries").countDocuments()).toBe(0);
      });
      it("flushes landed cash even when later work fails", async () => {
        const { db } = await world(native);
        await writeBalanceSnapshot(db, 1);
        await expect(
          withBondPoolLedgerSnapshot(db, 2, async () => {
            await creditBondPool(db, "USD", 100, "purchasesIn");
            throw new Error("later work failed");
          })
        ).rejects.toThrow("later work failed");
        expect((await close(db))?.entriesChecked).toBe(1);
      });
      it.each(["USD", "GBP"] as const)(
        "reconciles the actual autonomous buyer and pool in %s",
        async (currency) => {
          const { db, rate } = await world(native, currency);
          const b = bond(currency);
          await db.collection("bonds").insertOne(b);
          const npp = {
            _id: new ObjectId(),
            countryId: b.countryId,
            nppInvestmentCashAnchor: 50000,
          };
          await db.collection("npps").insertOne(npp);
          await writeBalanceSnapshot(db, 1);
          const result = await withBondPoolLedgerSnapshot(db, 2, () =>
            nppBuyBond(db, npp as NPP, b._id, 3, 2, rate)
          );
          if (!result.ok) throw new Error(result.reason);
          expect(result.ok).toBe(true);
          expect(
            (await db.collection("npps").findOne({ _id: npp._id }))?.nppInvestmentCashAnchor
          ).toBeCloseTo(50000 - result.costAnchor, 8);
          expect((await close(db))?.entriesChecked).toBe(2);
        }
      );
      it.each(["USD", "GBP"] as const)(
        "reconciles the actual fund buyer and pool in %s",
        async (currency) => {
          const { db, rate } = await world(native, currency);
          const b = bond(currency);
          await db.collection("bonds").insertOne(b);
          const fund = {
            _id: new ObjectId(),
            name: "Fixture fund",
            quotedNav: 100,
            anchorCurrencyCode: "USD",
            cashAnchor: 50000,
          } as IndexFund;
          await db.collection("indexFunds").insertOne(fund);
          await writeBalanceSnapshot(db, 1);
          const result = await withBondPoolLedgerSnapshot(db, 2, () =>
            purchaseBondUnitsForFund(db, fund, b, 3, {
              turn: 2,
              fxRates: { [currency]: rate },
              thresholds: { fund: {} },
              turnLengthMinutes: 60,
            })
          );
          if (!result.ok) throw new Error(result.reason);
          expect(result.ok).toBe(true);
          expect(
            (await db.collection("indexFunds").findOne({ _id: fund._id }))?.cashAnchor
          ).toBeCloseTo(50000 - result.costAnchor, 8);
          expect((await close(db))?.entriesChecked).toBe(2);
        }
      );
    }
  );
}

it("isolates simultaneous worlds and currencies; never reuses a finished phase", async () => {
  const a = await world(false, "USD"),
    b = await world(false, "GBP");
  await writeBalanceSnapshot(a.db, 1);
  await writeBalanceSnapshot(b.db, 1);
  await Promise.all(
    [a, b].map(({ db, currency }) =>
      withBondPoolLedgerSnapshot(db, 2, async () => {
        await Promise.all([1, 2, 3].map(() => creditBondPool(db, currency, 100, "purchasesIn")));
      })
    )
  );
  await close(a.db);
  await close(b.db);
  expect((await a.db.collection("ledgerEntries").findOne({ turn: 2 }))?.legs[0].anchorAmount).toBe(
    100
  );
  expect((await b.db.collection("ledgerEntries").findOne({ turn: 2 }))?.legs[0].anchorAmount).toBe(
    50
  );
  await a.db
    .collection("gameState")
    .updateOne({ _id: "current" } as never, { $set: { currentTurn: 2 } });
  await creditBondPool(a.db, "USD", 100, "purchasesIn");
  expect(await a.db.collection("ledgerEntries").countDocuments({ turn: 3 })).toBe(1);
});

describe.skipIf(!nativeEnabled || process.env.AHD_POOL_SECONDARY_REPLICA !== "1")(
  "transactional secondary pool batches",
  () => {
    it.each(["USD", "GBP"] as const)(
      "commits actual fund cash, holdings and pool witnesses in %s",
      async (currency) => {
        const { db, rate } = await world(true, currency);
        const b = bond(currency);
        await db.collection("bonds").insertOne(b);
        const fund = {
          _id: new ObjectId(),
          name: "Fixture fund",
          quotedNav: 100,
          anchorCurrencyCode: "USD",
          cashAnchor: 50000,
        } as IndexFund;
        await db.collection("indexFunds").insertOne(fund);
        const planned = await planBondUnitsForFund(db, fund, b, 3, {
          fxRates: { [currency]: rate },
        });
        if (!planned.ok) throw new Error(planned.reason);
        const purchases = [{ plan: planned.plan, now: new Date() }];
        await writeBalanceSnapshot(db, 1);
        const session = client!.startSession();
        try {
          await withBondPoolLedgerSnapshot(db, 2, () =>
            session.withTransaction(async () => {
              await settleBondPurchasesInTransaction(db, session, fund, purchases);
            })
          );
        } finally {
          await session.endSession();
        }
        const ledgerSink: TxInput[] = [];
        recordSettledBondPurchase(fund, planned.plan, purchases[0].now, { turn: 2, ledgerSink });
        await emitTxBulk(db, ledgerSink, { fund: {} });
        expect((await close(db))?.entriesChecked).toBe(2);
        expect((await db.collection("bonds").findOne({ _id: b._id }))?.publicFloat).toBe(997);
      }
    );
    it.each(["USD", "GBP"] as const)(
      "an outer abort rolls back pool witnesses with all actual money in %s",
      async (currency) => {
        const { db, rate } = await world(true, currency);
        const b = bond(currency);
        await db.collection("bonds").insertOne(b);
        const fund = {
          _id: new ObjectId(),
          name: "Fixture fund",
          quotedNav: 100,
          anchorCurrencyCode: "USD",
          cashAnchor: 50000,
        } as IndexFund;
        await db.collection("indexFunds").insertOne(fund);
        const planned = await planBondUnitsForFund(db, fund, b, 3, {
          fxRates: { [currency]: rate },
        });
        if (!planned.ok) throw new Error(planned.reason);
        const purchases = [{ plan: planned.plan, now: new Date() }];
        const session = client!.startSession();
        try {
          await expect(
            withBondPoolLedgerSnapshot(db, 2, () =>
              session.withTransaction(async () => {
                await settleBondPurchasesInTransaction(db, session, fund, purchases);
                throw new Error("abort after actual pool credit");
              })
            )
          ).rejects.toThrow("abort after actual pool credit");
        } finally {
          await session.endSession();
        }
        expect(await db.collection("ledgerEntries").countDocuments()).toBe(0);
        expect((await db.collection("indexFunds").findOne({ _id: fund._id }))?.cashAnchor).toBe(
          50000
        );
        expect((await db.collection("bonds").findOne({ _id: b._id }))?.publicFloat).toBe(1000);
        expect(
          (
            await db
              .collection<{ _id: string; cashLocal: number }>("bondMarketPools")
              .findOne({ _id: currency })
          )?.cashLocal
        ).toBe(10000);
      }
    );
  }
);

describe.skipIf(!nativeEnabled)("pool phase command budget", () => {
  it.each([0, 1, 8])("shares metadata and one ledger insert across %i trades", async (count) => {
    const { db } = await world(true);
    const commands: string[] = [];
    const record = (event: { databaseName: string; commandName: string }) => {
      if (event.databaseName === db.databaseName) commands.push(event.commandName);
    };
    client!.on("commandStarted", record);
    try {
      await withBondPoolLedgerSnapshot(db, 2, () =>
        Promise.all(
          Array.from({ length: count }, () => creditBondPool(db, "USD", 100, "purchasesIn"))
        )
      );
    } finally {
      client!.off("commandStarted", record);
    }
    expect(commands.filter((name) => name === "find")).toHaveLength(count === 0 ? 0 : 2);
    expect(commands.filter((name) => name === "insert")).toHaveLength(count === 0 ? 0 : 1);
    expect(commands.filter((name) => name === "update")).toHaveLength(count);
    console.log(JSON.stringify({ poolPhaseTrades: count, roundTrips: commands.length, commands }));
  });
});
