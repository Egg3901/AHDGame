/** Synthetic stock-tax qualification. Uses no configured database or player data. */
import assert from "node:assert/strict";
import { writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { BSON, ObjectId, type Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { processPlayerIncomeTax } from "@/lib/budget/playerIncomeTax";
import { pendingStockTaxReceipt } from "@/lib/corporations/rules/stockTaxReceipt";
import {
  holdingDividendSplit,
  matureHoldingTerms,
  purchasedHoldingTerms,
  takeHoldingShares,
} from "@/lib/corporations/rules/holdingTerms";
import type { Character } from "@/lib/db/types";

function countedDb(memory: InMemoryDb) {
  let commands = 0,
    bytes = 0;
  const cache = new Map<string, object>();
  const measure = (value: unknown) => {
    if (value && typeof value === "object") bytes += BSON.calculateObjectSize({ value });
  };
  const db = {
    collection(name: string) {
      if (cache.has(name)) return cache.get(name);
      const collection = memory.collection(name);
      const proxy = new Proxy(collection, {
        get(target, property) {
          const value = Reflect.get(target, property);
          if (typeof value !== "function") return value;
          if (property === "find")
            return (...args: unknown[]) => {
              const cursor = Reflect.apply(value, target, args);
              if (!cursor || typeof cursor !== "object") throw new Error("Invalid fixture cursor");
              const wrapped = new Proxy(cursor, {
                get(cursorTarget, cursorProperty) {
                  const method = Reflect.get(cursorTarget, cursorProperty);
                  if (typeof method !== "function") return method;
                  if (cursorProperty === "toArray")
                    return async () => {
                      commands++;
                      const rows = await method.call(cursorTarget);
                      for (const row of rows) measure(row);
                      return rows;
                    };
                  return (...cursorArgs: unknown[]) => {
                    const result = Reflect.apply(method, cursorTarget, cursorArgs);
                    return result === cursorTarget ? wrapped : result;
                  };
                },
              });
              return wrapped;
            };
          return async (...args: unknown[]) => {
            commands++;
            const result = await Reflect.apply(value, target, args);
            if (property === "findOne") measure(result);
            return result;
          };
        },
      });
      cache.set(name, proxy);
      return proxy;
    },
  } as unknown as Db;
  return {
    db,
    stats: () => ({ roundTrips: commands, projectedDocumentBsonBytes: bytes }),
    reset: () => {
      commands = 0;
      bytes = 0;
    },
  };
}

const now = new Date("2026-10-16T00:00:00Z");
function fixture(players: number) {
  const memory = createInMemoryDb();
  memory.seed("federalBudget", [
    {
      _id: "federal",
      countryId: "US",
      currencyCode: "USD",
      taxRates: {
        incomeTaxLow: 10,
        incomeTaxMiddle: 20,
        incomeTaxHigh: 30,
        capitalGainsTaxLow: 5,
        capitalGainsTaxMiddle: 15,
        capitalGainsTaxHigh: 25,
      },
      treasuryCashLocal: 1000,
      treasuryBalance: 1000,
    },
  ]);
  memory.seed("stateBudgets", [
    {
      _id: "US_TEST",
      countryId: "US",
      taxRates: {
        incomeTax: 5,
        capitalGainsTaxLow: 2,
        capitalGainsTaxMiddle: 2,
        capitalGainsTaxHigh: 2,
      },
      balance: 1000,
    },
  ]);
  memory.seed("exchangeRates", [{ _id: "USD", currencyCode: "USD", rate: 1 }]);
  memory.seed("macroMetrics", [{ _id: "US_TEST", economic: { medianIncome: { value: 1000 } } }]);
  const actors = Array.from({ length: players }, (_, i) => ({
    _id: new ObjectId((i + 1).toString(16).padStart(24, "0")),
    name: "Synthetic taxpayer",
    countryId: "US",
    homeState: "US_TEST",
    incomeTaxStartTurn: 1,
    incomeTier: "low",
    cashOnHand: 1e6,
  }));
  memory.seed("characters", actors);
  return { memory, actors, ...countedDb(memory) };
}
async function scaling(players: number, stockActive: boolean) {
  const { memory, db, actors, reset, stats } = fixture(players);
  const rows = actors.map((actor, i) => ({
    _id: new ObjectId(),
    subjectType: "character",
    subjectId: actor._id,
    type: "corp_salary",
    turn: 1,
    amount: [100, 250, 1000][i % 3],
    anchorAmount: [100, 250, 1000][i % 3],
    currencyCode: "USD",
  }));
  memory.seed("financialTxLog", rows);
  if (stockActive)
    for (const actor of actors)
      await db.collection<Character>("characters").updateOne(
        { _id: actor._id },
        {
          $push: {
            pendingStockTaxReceipts: pendingStockTaxReceipt({
              id: "synthetic-gain",
              currencyCode: "USD",
              holdingTerms: {
                longTermShares: 10,
                longTermCostBasisAnchor: 900,
                shortTermLots: [],
              },
              proceedsAnchor: 1000,
              proceedsCredited: 1000,
              saleTurn: 1,
              assessmentTurn: 1,
            }),
          },
        }
      );
  reset();
  await processPlayerIncomeTax(
    db,
    1,
    now,
    {
      forexEnabled: false,
      resetWorldId: "synthetic",
      ...(stockActive ? { stockHoldingTaxStartTurn: 0 } : {}),
    },
    true
  );
  return { players, stockActive, ...stats() };
}
async function trajectory(capitalRateZero: boolean) {
  const { memory, db, actors } = fixture(3);
  if (capitalRateZero)
    await db.collection("federalBudget").updateOne(
      {},
      {
        $set: {
          "taxRates.capitalGainsTaxLow": 0,
          "taxRates.capitalGainsTaxMiddle": 0,
          "taxRates.capitalGainsTaxHigh": 0,
        },
      }
    );
  let gross = 0;
  let terms = purchasedHoldingTerms(96, 4, 0);
  let incomeDividends = 0,
    capitalDividends = 0,
    incomeGains = 0,
    capitalGains = 0;
  for (let turn = 1; turn <= 96; turn++) {
    terms = matureHoldingTerms(terms, turn);
    const split = holdingDividendSplit(terms, 12, turn);
    if (turn < 48) assert.equal(split.capital, 0);
    else assert.equal(split.income, 0);
    incomeDividends += split.income;
    capitalDividends += split.capital;
    const sale = takeHoldingShares(terms, 1, turn < 48 ? "short" : "long", turn);
    terms = sale.remaining;
    const price = turn % 7 === 0 ? 3 : 10;
    const receipt = pendingStockTaxReceipt({
      id: "sale:" + turn,
      currencyCode: "USD",
      holdingTerms: sale.taken,
      proceedsAnchor: price,
      proceedsCredited: price,
      saleTurn: turn,
      assessmentTurn: turn,
    });
    assert.equal(receipt.incomeAmount + receipt.capitalAmount, Math.max(0, price - 4));
    incomeGains += receipt.incomeAmount;
    capitalGains += receipt.capitalAmount;
    for (const [i, actor] of actors.entries()) {
      const salary = [10, 25, 100][i];
      gross += salary + 12 + price;
      await db
        .collection<Character>("characters")
        .updateOne(
          { _id: actor._id },
          { $inc: { cashOnHand: salary + 12 + price }, $push: { pendingStockTaxReceipts: receipt } }
        );
      await db.collection("financialTxLog").insertMany([
        {
          _id: new ObjectId(),
          subjectType: "character",
          subjectId: actor._id,
          type: "corp_salary",
          turn,
          amount: salary,
          anchorAmount: salary,
          currencyCode: "USD",
        },
        {
          _id: new ObjectId(),
          subjectType: "character",
          subjectId: actor._id,
          type: "corp_dividend",
          turn,
          amount: 12,
          anchorAmount: 12,
          currencyCode: "USD",
          meta: {
            stockTax: {
              version: 1,
              assessmentTurn: turn,
              incomeAmount: split.income,
              capitalAmount: split.capital,
            },
          },
        },
      ]);
    }
    await processPlayerIncomeTax(
      db,
      turn,
      now,
      { forexEnabled: false, resetWorldId: "synthetic", stockHoldingTaxStartTurn: 0 },
      true
    );
    const before = JSON.stringify(memory.collection("characters").docs);
    await processPlayerIncomeTax(
      db,
      turn,
      now,
      { forexEnabled: false, resetWorldId: "synthetic", stockHoldingTaxStartTurn: 0 },
      true
    );
    assert.equal(
      JSON.stringify(memory.collection("characters").docs),
      before,
      "Replay changed player money or history"
    );
  }
  const cash = memory
    .collection("characters")
    .docs.reduce((sum, actor) => sum + (actor.cashOnHand as number), 0);
  const national = (await db.collection("federalBudget").findOne({}))!.treasuryCashLocal as number;
  const regional = (await db.collection("stateBudgets").findOne({}))!.balance as number;
  assert.equal(
    cash + national + regional,
    3e6 + 2000 + gross,
    "Player and treasury money does not conserve"
  );
  assert.equal(terms.longTermShares, 0);
  return {
    turns: 96,
    players: 3,
    capitalRateZero,
    gross,
    incomeDividends,
    capitalDividends,
    incomeGains,
    capitalGains,
    cash,
    national,
    regional,
  };
}
async function main() {
  const control = await trajectory(false),
    reform = await trajectory(true);
  assert.ok(
    reform.cash > control.cash,
    "Independent capital-gains reform did not affect player cash"
  );
  const performance: Array<Awaited<ReturnType<typeof scaling>>> = [];
  for (const stockActive of [false, true])
    for (const players of [1, 10, 100]) performance.push(await scaling(players, stockActive));
  for (const active of [false, true]) {
    const subset = performance.filter((row) => row.stockActive === active);
    assert.ok(
      subset.every((row) => row.roundTrips === subset[0].roundTrips),
      "Tax commands grow with player count"
    );
  }
  const hash = createHash("sha256");
  for (const file of [
    "src/lib/budget/playerIncomeTax.ts",
    "src/lib/budget/playerIncomeTaxSettlement.ts",
    "src/lib/budget/rules/incomeTaxTiers.ts",
    "src/lib/budget/rules/capitalGainsTax.ts",
    "src/lib/corporations/rules/holdingTerms.ts",
    "src/lib/corporations/rules/stockTaxReceipt.ts",
  ])
    hash.update(file).update(await readFile(file));
  const report = {
    verdict: "passed",
    scope:
      "Synthetic 96-turn holding maturation, profit-only sale taxation, dividends, loss exemption, independent capital-gains reform, replay, treasury conservation and batched tax I/O. Not a full-world turn or network benchmark.",
    baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    sourceFingerprint: hash.digest("hex"),
    control,
    reform,
    performance,
    performanceNote:
      "In-memory driver command counts and projected document BSON bytes. Actual Mongo server latency and envelopes are not modeled.",
  };
  const out = process.argv.indexOf("--out");
  if (out >= 0) {
    assert.ok(process.argv[out + 1], "--out requires a path");
    await writeFile(process.argv[out + 1], JSON.stringify(report, null, 2) + "\n");
  }
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
void main().catch((error) => {
  process.stderr.write(String(error) + "\n");
  process.exitCode = 1;
});
