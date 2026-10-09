/**
 * Round-trip budgets for the index-fund turn phase (#2271, #2692).
 *
 * The real cron runs against the in-memory db with a counter on every
 * collection call. Budgets are asserted so an N+1 reintroduced anywhere in the
 * phase fails here, rather than surfacing as a 240s phase timeout on a
 * full-flags world. Scaling is asserted separately: doubling the funds must not
 * double the per-fund overhead of the passes that touch no trades.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { countRoundTrips } from "@/lib/test-utils/roundTripCounter";
import { getDb } from "@/lib/mongodb";
import { runIndexFundCron } from "./fundCron";
import { getAllFundDefinitions } from "./fundDefinitions";
import { listActiveFunds, listFundsByIds, getFundById } from "./fundQueries";
import { staggerPhase } from "@/lib/turn/staggerPhase";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/db/transactionSupport", () => ({
  assertTransactionSupportAtBoot: vi.fn(async () => false),
}));
beforeEach(() => vi.clearAllMocks());

const NOW = new Date("2000-01-01T00:00:00Z");
const TYPES = [
  "technology",
  "financial",
  "energy",
  "retail",
  "manufacturing",
  "healthcare",
] as const;

function world(fundCount: number, corpCount = 120) {
  const memory = createInMemoryDb();
  const db = memory as unknown as Db;
  const corps = Array.from({ length: corpCount }, (_, i) => ({
    _id: new ObjectId(),
    name: `Corp ${i}`,
    type: TYPES[i % TYPES.length],
    countryId: "US",
    liquidCurrencyCode: "USD",
    shareBuybackMode: "instant",
    sharePrice: 50 + i,
    fundamentalSharePrice: 50 + i,
    totalShares: 1_000_000,
    publicFloat: 200_000,
    liquidCapital: 1_000_000,
    shareholders: [],
    shareIssuanceProceeds: 0,
    createdAt: NOW,
    updatedAt: NOW,
  }));
  const defs = getAllFundDefinitions()
    .filter((d) => d.kind !== "bond" && (d.countryId === "US" || d.scope === "global"))
    .slice(0, fundCount);
  const funds = defs.map((d) => ({
    _id: new ObjectId(),
    slug: d.slug,
    name: d.name,
    tickerSymbol: d.ticker,
    scope: d.scope,
    kind: d.kind,
    ...(d.countryId ? { countryId: d.countryId } : {}),
    ...(d.sectorType ? { sectorType: d.sectorType } : {}),
    anchorCurrencyCode: d.anchorCurrencyCode,
    status: "active",
    quotedNav: 100,
    unitSupply: 100_000,
    reserveUnits: 0,
    cashAnchor: 5_000_000,
    holdings: [],
    targetConstituents: [],
    createdAt: NOW,
    updatedAt: NOW,
  }));
  memory.seed("indexFunds", funds as never);
  memory.seed("corporations", corps as never);
  memory.seed("equityMarketPools", [
    {
      _id: "USD",
      cashLocal: 5_000_000,
      targetCashLocal: 5_000_000,
      lifetime: { purchasesIn: 0 },
      createdAt: NOW,
      updatedAt: NOW,
    },
  ]);
  memory.seed("gameConfig", [
    { _id: "default", indexFundsMode: "full", ledgerShadow: true, auditLog: true },
  ]);
  memory.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
  memory.seed("gameState", [{ _id: "current", currentTurn: 47 }]);
  vi.mocked(getDb).mockResolvedValue(db);
  return { memory, db, funds: funds.length };
}

/**
 * A turn after 48 on which no fund in the world has its staggered rebalance
 * slot, so the pass does only the every-turn work.
 */
function quietTurn(w: ReturnType<typeof world>): number {
  const ids = w.memory.collection("indexFunds").docs.map((fund) => String(fund._id));
  for (let turn = 49; turn < 49 + TURNS_PER_DAY; turn++)
    if (!ids.some((id) => staggerPhase(id, TURNS_PER_DAY) === turn % TURNS_PER_DAY)) return turn;
  throw new Error("every turn of the day holds a fund's rebalance");
}

describe("index fund cron round trips", () => {
  it("keeps a rebalance turn inside its round-trip budget", async () => {
    const w = world(12);
    const trips = countRoundTrips(w.memory);
    const result = await runIndexFundCron(w.db, { currentTurn: 48 });
    expect(result.errors).toEqual([]);
    expect(result.floatPurchases).toBeGreaterThan(150);
    // Trade settlement dominates, and a batch costs a handful of trips per
    // trade rather than the ~50 a one-settlement-per-trade run needed.
    expect(trips.total() / result.floatPurchases, trips.summary()).toBeLessThan(15);
    // Fixed per-fund overhead of the non-trade passes.
    const nonTrade =
      trips.total() -
      trips.count("bankMoneyMoves") -
      trips.count("corporations") -
      trips.count("equityMarketPools") -
      trips.count("fundFloatSettlements");
    expect(nonTrade, trips.summary()).toBeLessThan(40 * w.funds + 60);
  }, 280_000);

  it("keeps a quiet turn at a small, fund-linear number of round trips", async () => {
    const w = world(12);
    await runIndexFundCron(w.db, { currentTurn: 48 });
    const trips = countRoundTrips(w.memory);
    const result = await runIndexFundCron(w.db, { currentTurn: quietTurn(w) });
    expect(result.errors).toEqual([]);
    expect(result.floatPurchases).toBe(0);
    expect(trips.total(), trips.summary()).toBeLessThan(15 * w.funds + 60);
    expect(trips.count("shareOrders", "find")).toBeLessThanOrEqual(4);
    expect(trips.count("indexFundSnapshots")).toBeLessThanOrEqual(2);
  }, 280_000);

  it("does not grow the quiet-turn per-fund cost as funds are added", async () => {
    const small = world(4);
    await runIndexFundCron(small.db, { currentTurn: 48 });
    const smallTrips = countRoundTrips(small.memory);
    await runIndexFundCron(small.db, { currentTurn: quietTurn(small) });
    const big = world(12);
    await runIndexFundCron(big.db, { currentTurn: 48 });
    const bigTrips = countRoundTrips(big.memory);
    await runIndexFundCron(big.db, { currentTurn: quietTurn(big) });
    const perFund = (bigTrips.total() - smallTrips.total()) / (big.funds - small.funds);
    expect(perFund, `${smallTrips.summary()} | ${bigTrips.summary()}`).toBeLessThan(12);
  }, 280_000);
});

describe("fund document size", () => {
  it("never reads the in-flight settlement plan on whole-fund reads", async () => {
    const w = world(3);
    const reads: unknown[] = [];
    const funds = w.memory.collection("indexFunds");
    const find = funds.find.bind(funds);
    const findOne = funds.findOne.bind(funds);
    funds.find = ((filter: never, options: unknown) => {
      reads.push(options);
      return find(filter);
    }) as never;
    funds.findOne = ((filter: never, options: unknown) => {
      reads.push(options);
      return findOne(filter);
    }) as never;
    const all = await listActiveFunds(w.db);
    await listFundsByIds(
      w.db,
      all.map((fund) => fund._id)
    );
    await getFundById(w.db, all[0]._id);
    expect(reads).toHaveLength(3);
    for (const options of reads)
      expect(options).toMatchObject({ projection: { floatSettlementPlan: 0 } });
  });
});
