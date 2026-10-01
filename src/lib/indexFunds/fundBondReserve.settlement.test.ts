import { beforeEach, describe, expect, it, vi } from "vitest";
import { BSON, ObjectId, type Db } from "mongodb";
import type { Bond, IndexFund } from "@/lib/db/types";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { deployBondReserveFromCash } from "./fundBondReserve";

vi.mock("@/lib/currency/corporationCapital", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/currency/corporationCapital")>()),
  loadFxRatesRecord: vi.fn(async () => ({ USD: 1 })),
}));

// The transaction under test: run the body against the in-memory store and
// restore every collection if it throws, which is what an aborted Mongo
// transaction guarantees.
let activeMemory: InMemoryDb;
// A write another player makes between the plan and the commit.
let concurrentWrite: (() => void) | undefined;
vi.mock("@/lib/mongodb", () => ({ getMongoClient: vi.fn() }));
vi.mock("@/lib/db/transactionWithRetry", () => ({
  runTransactionWithSessionRetry: vi.fn(
    async (_client: unknown, run: (session?: unknown) => Promise<unknown>) => {
      concurrentWrite?.();
      const snapshot = new Map(
        Array.from(activeMemory.collections, ([name, col]) => [
          name,
          BSON.serialize({ docs: col.docs }),
        ])
      );
      try {
        return await run({});
      } catch (err) {
        for (const [name, bytes] of snapshot) {
          activeMemory.collection(name).docs = BSON.deserialize(bytes).docs;
        }
        throw err;
      }
    }
  ),
}));

const fundId = new ObjectId("6a0000000000000000000001");
const heldBondId = new ObjectId("6a0000000000000000000010");

function world(): InMemoryDb {
  const memory = createInMemoryDb();
  const bond = (id: string, overrides: Partial<Bond> = {}) => ({
    _id: new ObjectId(id),
    issuerType: "sovereign",
    issuerName: "United States",
    countryId: "US",
    currencyCode: "USD",
    matured: false,
    defaulted: false,
    publicFloat: 400,
    totalIssued: 10_000_000,
    faceValue: 1000,
    marketPrice: 0.98,
    maturityTurn: 200,
    holders: [],
    ...overrides,
  });
  memory.seed("bonds", [
    bond("6a0000000000000000000011", { maturityTurn: 150 }),
    bond(heldBondId.toHexString(), {
      maturityTurn: 160,
      holders: [{ fundId, units: 25, avgCostPerUnit: 990 }],
    } as Partial<Bond>),
    bond("6a0000000000000000000012", { maturityTurn: 170, publicFloat: 60 }),
    bond("6a0000000000000000000013", { maturityTurn: 180, marketPrice: 1.01 }),
  ]);
  memory.seed("bondMarketPools", [
    { _id: "USD", cashLocal: 250_000, targetCashLocal: 500_000, lifetime: {} },
  ]);
  memory.seed("indexFunds", [fundDoc() as unknown as Record<string, unknown>]);
  return memory;
}

function fundDoc(): IndexFund {
  return {
    _id: fundId,
    name: "Test Broad",
    slug: "test-broad",
    kind: "broad",
    scope: "country",
    countryId: "US",
    anchorCurrencyCode: "USD",
    cashAnchor: 600_000,
    quotedNav: 100,
    unitSupply: 10_000,
    holdings: [],
    targetConstituents: [],
  } as unknown as IndexFund;
}

function state(memory: InMemoryDb) {
  const strip = <T extends Record<string, unknown>>(doc: T) => {
    const { updatedAt: _u, createdAt: _c, _id: _i, ...rest } = doc;
    return rest;
  };
  return {
    fund: strip(memory.collection("indexFunds").docs[0]!),
    bonds: memory.collection("bonds").docs.map((b) => ({
      id: String(b._id),
      publicFloat: b.publicFloat,
      holders: b.holders,
    })),
    pool: strip(memory.collection("bondMarketPools").docs[0]!),
    receipts: memory.collection("indexFundTransactions").docs.map((d) => strip(d)),
  };
}

async function deploy(memory: InMemoryDb, settleInTransaction: boolean) {
  activeMemory = memory;
  return deployBondReserveFromCash(memory as unknown as Db, fundDoc(), 0, {
    liquidityTargetEnabled: true,
    settleInTransaction,
  });
}

describe("bond reserve batched settlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    concurrentWrite = undefined;
  });

  it("leaves the same books as settling each purchase on its own", async () => {
    const sequential = world();
    const batched = world();

    const sequentialResult = await deploy(sequential, false);
    const batchedResult = await deploy(batched, true);

    expect(sequentialResult.unitsPurchased).toBeGreaterThan(0);
    expect(batchedResult).toEqual(sequentialResult);
    expect(state(batched)).toEqual(state(sequential));
    // Both reservation shapes ran: a top-up of an existing holder row and a new row.
    const fundRows = state(batched).bonds.map((b) =>
      (b.holders as { fundId?: ObjectId; units: number }[]).find((h) => h.fundId?.equals(fundId))
    );
    expect(
      fundRows.find((_, i) => state(batched).bonds[i]!.id === heldBondId.toHexString())!.units
    ).toBeGreaterThan(25);
    expect(fundRows.filter(Boolean).length).toBeGreaterThan(1);
  });

  it("commits nothing from the batch when a guard misses, then settles per purchase", async () => {
    const batched = world();
    const before = state(batched);
    // Another buyer drains every issue's float after the plan was made: the
    // batch's reservation guards miss, so the transaction must roll back, and
    // the per-purchase fallback must refund each debit whose reservation fails.
    concurrentWrite = () => {
      for (const bond of batched.collection("bonds").docs) bond.publicFloat = 0;
    };
    const fundDebits = vi.spyOn(batched.collection("indexFunds"), "bulkWrite");

    const result = await deploy(batched, true);

    expect(fundDebits).toHaveBeenCalledTimes(1);
    expect(result.unitsPurchased).toBe(0);
    expect(result.deployedAnchor).toBe(0);
    const after = state(batched);
    expect(after.fund).toEqual(before.fund);
    expect(after.pool).toEqual(before.pool);
    expect(after.receipts).toEqual([]);
    expect(after.bonds.map((b) => b.holders)).toEqual(before.bonds.map((b) => b.holders));
  });
});
