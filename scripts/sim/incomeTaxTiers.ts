/** Synthetic income-tax qualification. No configured database or player data is used. */
import { ObjectId, BSON, type Db } from "mongodb";
import { writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { processPlayerIncomeTax } from "@/lib/budget/playerIncomeTax";
import { refreshIncomeTaxShares } from "@/lib/budget/incomeTaxShares";
import { migration } from "@/lib/migrations/entries/2026-10-16-income-tax-tiers";
import { incomeTaxRevenue } from "@/lib/budget/rules/incomeTaxTiers";
import { advanceTaxRatePhaseIn } from "@/lib/budget/taxRatePhaseIn";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
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
function fixture(players: number) {
  const memory = createInMemoryDb();
  memory.seed("gameState", [
    { _id: "current", currentTurn: 0, startingYear: 1991, preset: "1991-default" },
  ]);
  memory.seed("states", [{ _id: "US_TEST", countryId: "US", population: 100000 }]);
  memory.seed("federalBudget", [
    {
      _id: "federal",
      countryId: "US",
      currencyCode: "USD",
      taxRates: { incomeTax: 20 },
      treasuryBalance: 1e6,
      treasuryCashLocal: 1e6,
      revenue: { incomeTax: 2e7 },
    },
  ]);
  memory.seed("stateBudgets", [
    { _id: "US_TEST", countryId: "US", taxRates: { incomeTax: 5 }, balance: 1e6 },
  ]);
  memory.seed("macroMetrics", [{ _id: "US_TEST", economic: { medianIncome: { value: 100000 } } }]);
  memory.seed("exchangeRates", [{ _id: "USD", currencyCode: "USD", rate: 1 }]);
  memory.seed("legislationTypes", [
    {
      _id: "sim_tax",
      name: "Income tax",
      countryScope: "us",
      policyDomain: "tax",
      taxRateChange: { scope: "federal", taxType: "incomeTax" },
      policyOptions: [{ id: "a", rate: 20, economic: 0, social: 0 }],
    },
  ]);
  memory.seed(
    "characters",
    Array.from({ length: players }, (_, index) => ({
      _id: new ObjectId((index + 1).toString(16).padStart(24, "0")),
      name: "Synthetic taxpayer",
      countryId: "US",
      homeState: "US_TEST",
      demographics: { wealth: "low" },
      currencyBalances: { personal: { USD: 1e6 }, savings: { USD: 0 } },
    }))
  );
  return { memory, ...countedDb(memory) };
}
const time = new Date("2026-10-16T00:00:00Z");
async function trajectory(reform: boolean) {
  const { memory, db, stats, reset } = fixture(12);
  const before = JSON.stringify(memory.collection("federalBudget").docs);
  await migration.execute(db, { dryRun: true });
  assert(
    JSON.stringify(memory.collection("federalBudget").docs) === before,
    "Dry run mutated the world"
  );
  await migration.execute(db, { dryRun: false });
  let budget = await db.collection("federalBudget").findOne({});
  assert(budget, "Budget missing");
  assert(
    incomeTaxRevenue(1e8, budget.taxRates, budget.incomeTaxShares) === 2e7,
    "Migration changed opening macro revenue"
  );
  if (reform)
    await db
      .collection("federalBudget")
      .updateOne(
        {},
        { $set: { taxRatePhaseIn: { incomeTaxLow: 5, incomeTaxMiddle: 20, incomeTaxHigh: 40 } } }
      );
  reset();
  let gross = 0,
    principal = 0;
  for (let turn = 1; turn <= 96; turn++) {
    budget = await db.collection("federalBudget").findOne({});
    assert(budget, "Budget missing");
    const next = advanceTaxRatePhaseIn(budget.taxRates, budget.taxRatePhaseIn);
    await db
      .collection("federalBudget")
      .updateOne(
        {},
        { $set: { taxRates: { ...budget.taxRates, ...next.rates }, taxRatePhaseIn: next.pending } }
      );
    await refreshIncomeTaxShares(db);
    const incomeRows = [];
    for (const [index, character] of memory.collection("characters").docs.entries()) {
      const salary = [500, 2500, 6000][index % 3];
      gross += salary;
      await memory
        .collection("characters")
        .updateOne({ _id: character._id }, { $inc: { "currencyBalances.personal.USD": salary } });
      incomeRows.push({
        _id: new ObjectId(),
        subjectId: character._id,
        subjectType: "character",
        type: "corp_salary",
        turn,
        amount: salary,
        currencyCode: "USD",
        anchorAmount: salary,
      });
      if (turn % 12 === 0) {
        principal += 5000;
        await memory
          .collection("characters")
          .updateOne({ _id: character._id }, { $inc: { "currencyBalances.personal.USD": 5000 } });
        incomeRows.push({
          _id: new ObjectId(),
          subjectId: character._id,
          subjectType: "character",
          type: "bond_maturity",
          turn,
          amount: 5000,
          currencyCode: "USD",
          anchorAmount: 5000,
        });
      }
    }
    await memory.collection("financialTxLog").insertMany(incomeRows);
    await processPlayerIncomeTax(
      db,
      turn,
      time,
      { forexEnabled: true, resetWorldId: "synthetic" },
      true,
      true
    );
    if (turn % 12 === 0)
      assert(
        (
          await processPlayerIncomeTax(
            db,
            turn,
            time,
            { forexEnabled: true, resetWorldId: "synthetic" },
            true,
            true
          )
        ).assessed === 0,
        "Replay created another assessment"
      );
  }
  const assessments = memory
    .collection("playerIncomeTaxAssessments")
    .docs.filter((row) => row.status !== "plan");
  const collected = assessments.reduce(
    (sum, row) => sum + (row.federal as number) + (row.regional as number),
    0
  );
  const cash = memory
    .collection("characters")
    .docs.reduce(
      (sum, row) => sum + (row.currencyBalances as { personal: { USD: number } }).personal.USD,
      0
    );
  const federal = memory.collection("federalBudget").docs[0],
    regional = memory.collection("stateBudgets").docs[0];
  assert(assessments.length === 12 * 96, "Missing assessments");
  assert(
    assessments.every((row) => row.status === "paid"),
    "Unpaid synthetic tax"
  );
  assert(
    Math.abs(cash - (12e6 + gross + principal - collected)) < 1e-6,
    "Personal accounting failed"
  );
  assert(
    Math.abs(
      (federal.treasuryCashLocal as number) + (regional.balance as number) - 2e6 - collected
    ) < 1e-6,
    "Treasury conservation failed"
  );
  const ledger = memory.collection("ledgerEntries").docs;
  assert(
    ledger.every(
      (row) =>
        Math.abs(
          (row.legs as { anchorAmount: number }[]).reduce((sum, leg) => sum + leg.anchorAmount, 0)
        ) < 1e-6
    ),
    "Unbalanced shadow evidence"
  );
  assert(
    memory.collection("financialTxLog").docs.filter((row) => row.type === "player_income_tax")
      .length === assessments.length,
    "Receipt count drift"
  );
  return {
    reform,
    turns: 96,
    players: 12,
    grossIncome: gross,
    exemptPrincipal: principal,
    playerTax: collected,
    endingPersonalCash: cash,
    ...stats(),
  };
}
async function scaling(players: number) {
  const { memory, db, stats, reset } = fixture(players);
  await migration.execute(db, { dryRun: false });
  memory.seed(
    "financialTxLog",
    memory.collection("characters").docs.map((character) => ({
      _id: new ObjectId(),
      subjectId: character._id,
      subjectType: "character",
      type: "corp_salary",
      turn: 1,
      amount: 6000,
      currencyCode: "USD",
      anchorAmount: 6000,
    }))
  );
  reset();
  await processPlayerIncomeTax(
    db,
    1,
    time,
    { forexEnabled: true, resetWorldId: "synthetic" },
    true,
    true
  );
  return { players, ...stats() };
}
async function main() {
  const control = await trajectory(false),
    reform = await trajectory(true);
  const performance: Array<Awaited<ReturnType<typeof scaling>>> = [];
  for (const players of [1, 10, 100]) performance.push(await scaling(players));
  assert(
    performance.every((row) => row.roundTrips === performance[0].roundTrips),
    "Tax round trips grow with player count"
  );
  const files = [
    "src/lib/budget/playerIncomeTax.ts",
    "src/lib/budget/playerIncomeTaxSettlement.ts",
    "src/lib/budget/incomeTaxShares.ts",
    "src/lib/budget/rules/incomeTaxTiers.ts",
    "src/lib/migrations/entries/2026-10-16-income-tax-tiers.ts",
  ];
  const hash = createHash("sha256");
  for (const file of files) hash.update(file).update(await readFile(file));
  const report = {
    verdict: "passed",
    scope:
      "Synthetic migration, tier phase-in, actual player-tax phases, cash conservation, principal exemption, receipt replay and batched I/O. Not a whole-world feedback simulation.",
    baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    sourceFingerprint: hash.digest("hex"),
    legacyMacroOpeningRevenue: 2e7,
    legacyPlayerWithholding: 0,
    control,
    reform,
    performance,
    performanceNote:
      "Counts instrument the isolated in-memory driver boundary. Bytes are projected BSON document sizes; network latency and server command envelopes are not modeled.",
  };
  const output = process.argv.indexOf("--out");
  if (output >= 0) {
    const path = process.argv[output + 1];
    if (!path) throw new Error("--out needs a path");
    await writeFile(path, JSON.stringify(report, null, 2) + "\n");
  }
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
void main().catch((error) => {
  process.stderr.write(String(error) + "\n");
  process.exitCode = 1;
});
