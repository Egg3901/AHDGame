/**
 * The real index-fund cron shares one queued-redemption claim budget across
 * funds (#3366). With more queued funds than claims, a fixed service order
 * would starve the funds at the back forever: holders keep queueing, the
 * front funds use every claim each turn, and the back funds never get one.
 * Every pass stays inside the budget, and every fund is eventually served.
 */
import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import type { IndexFund, IndexFundRedemptionQueueEntry } from "@/lib/db/types";
import { runIndexFundCron } from "./fundCron";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/db/transactionSupport", () => ({
  assertTransactionSupportAtBoot: vi.fn(async () => false),
}));

const NOW = new Date("2000-01-01T00:00:00Z");
const FUNDS = 5;
const BUDGET = 2;

function world() {
  const memory = createInMemoryDb();
  const db = memory as unknown as Db;
  const funds: IndexFund[] = Array.from({ length: FUNDS }, (_, i) => ({
    _id: new ObjectId(),
    slug: `fairness-${i}`,
    name: `Fairness ${i}`,
    tickerSymbol: `FR${i}`,
    scope: "country",
    kind: "broad",
    countryId: "US",
    anchorCurrencyCode: "USD",
    status: "active",
    quotedNav: 100,
    unitSupply: 10_000,
    reserveUnits: 0,
    cashAnchor: 1_000_000,
    holdings: [],
    targetConstituents: [],
    createdAt: NOW,
    updatedAt: NOW,
  }));
  const npps = funds.map((_, i) => ({
    _id: new ObjectId(),
    countryId: "US",
    name: `NPP ${i}`,
    nppInvestmentCashAnchor: 0,
  }));
  memory.seed("indexFunds", funds.map((f) => ({ ...f })) as never);
  memory.seed("npps", npps);
  memory.seed("gameConfig", [{ _id: "default", indexFundsMode: "full", ledgerShadow: true }]);
  memory.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
  memory.seed("gameState", [{ _id: "current", currentTurn: 1 }]);
  vi.mocked(getDb).mockResolvedValue(db);
  return { db, funds, npps };
}

/** One fresh request per fund, as holders keep redeeming turn after turn. */
async function queueOnePerFund(w: ReturnType<typeof world>, turn: number): Promise<void> {
  const at = new Date(NOW.getTime() + turn);
  const entries: IndexFundRedemptionQueueEntry[] = w.funds.map((fund, i) => ({
    _id: new ObjectId(),
    fundId: fund._id,
    holderKind: "npp",
    nppId: w.npps[i]._id,
    units: 10,
    requestedNavAnchor: 100,
    requestedAmountAnchor: 1_000,
    paidAmountAnchor: 0,
    status: "queued",
    unitsBurnedAtRequest: true,
    createdAt: at,
    updatedAt: at,
  }));
  await w.db
    .collection<IndexFundRedemptionQueueEntry>("indexFundRedemptionQueue")
    .insertMany(entries);
}

async function servedFundIds(db: Db): Promise<Set<string>> {
  const rows = await db
    .collection<IndexFundRedemptionQueueEntry>("indexFundRedemptionQueue")
    .find({ paidAmountAnchor: { $gt: 0 } })
    .toArray();
  return new Set(rows.map((r) => String(r.fundId)));
}

describe("index fund cron queued-redemption fairness", () => {
  it("bounds claims per turn and serves every fund when funds outnumber claims", async () => {
    const w = world();
    const turns = Math.ceil(FUNDS / BUDGET);
    for (let turn = 11; turn < 11 + turns; turn++) {
      await queueOnePerFund(w, turn);
      const result = await runIndexFundCron(w.db, {
        currentTurn: turn,
        queuedRedemptionClaimsPerPass: BUDGET,
      });
      expect(result.errors).toEqual([]);
      expect(result.redemptionsPaid).toBeLessThanOrEqual(BUDGET);
      expect(result.redemptionsPaid).toBeGreaterThan(0);
    }
    expect((await servedFundIds(w.db)).size).toBe(FUNDS);

    // Each holder's queue entries record exactly the cash it was credited.
    const queue = await w.db
      .collection<IndexFundRedemptionQueueEntry>("indexFundRedemptionQueue")
      .find({})
      .toArray();
    const redeemed = await w.db
      .collection("financialTxLog")
      .find({ type: "index_fund_redeem" })
      .toArray();
    expect(redeemed.length).toBeGreaterThanOrEqual(FUNDS);
    expect(queue.filter((e) => e.status === "processing")).toEqual([]);
    for (const npp of w.npps) {
      const owed = String(npp._id);
      const paid = queue
        .filter((e) => String(e.nppId) === owed)
        .reduce((s, e) => s + e.paidAmountAnchor, 0);
      const credited = redeemed
        .filter((r) => String(r.subjectId) === owed)
        .reduce((s, r) => s + Number(r.anchorAmount), 0);
      expect(paid).toBeCloseTo(credited, 6);
    }
    // Snapshots still cover every fund on every turn.
    const snapshots = await w.db.collection("indexFundSnapshots").countDocuments({});
    expect(snapshots).toBe(FUNDS * turns);
  });
});
