/**
 * The v6 stock-buy sweep settles real trades: NPP debit, share credit, IPO
 * issuer credit and equity pool credit all run against an in-memory store.
 * Pins two things the cost change must not break:
 *   - conservation: every unit of NPP cash debited lands in the pool or the
 *     issuer, per currency, to the cent;
 *   - identity: currency partitions settled concurrently, and pools read once
 *     per sweep, end in exactly the state a one-at-a-time replay with a fresh
 *     pool read per buy produces.
 */
import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";

vi.mock("@/lib/nppAutonomy/v3/finance/nppShares", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nppAutonomy/v3/finance/nppShares")>();
  return { ...actual, nppBuyShares: vi.fn(actual.nppBuyShares) };
});

import { nppBuyShares } from "@/lib/nppAutonomy/v3/finance/nppShares";
import { investNppStockSurplus } from "./nppActionProcessing";

const COUNTRIES = [
  { id: "US", currency: "USD" },
  { id: "UK", currency: "GBP" },
  { id: "JP", currency: "JPY" },
] as const;

function idFor(kind: number, i: number): ObjectId {
  return ObjectId.createFromHexString(
    kind.toString(16).padStart(2, "0") + i.toString(16).padStart(22, "0")
  );
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Doc = Record<string, unknown>;

function buildFixture(): Db {
  const rand = lcg(1991);
  const db = createInMemoryDb();
  const npps: Doc[] = [];
  const corps: Doc[] = [];
  let nppIndex = 0;
  let corpIndex = 0;
  for (const country of COUNTRIES) {
    const countryNpps: ObjectId[] = [];
    for (let i = 0; i < 150; i++) {
      const _id = idFor(1, nppIndex++);
      countryNpps.push(_id);
      npps.push({
        _id,
        countryId: country.id,
        retiredAt: null,
        personality: {
          loyalty: 50,
          ambition: Math.floor(rand() * 101),
          stubbornness: Math.floor(rand() * 101),
        },
        nppInvestmentCashAnchor: 6_000 + Math.floor(rand() * 60_000),
      });
    }
    for (let c = 0; c < 5; c++) {
      const sharePrice = 5 + Math.floor(rand() * 40);
      corps.push({
        _id: idFor(2, corpIndex++),
        countryId: country.id,
        liquidCurrencyCode: country.currency,
        sharePrice,
        fundamentalSharePrice: Math.round(sharePrice * (0.9 + rand() * 0.7) * 100) / 100,
        totalShares: 1_000_000,
        // Small floats so later buyers in a sweep see an earlier buy's depletion.
        publicFloat: 2_000 + Math.floor(rand() * 20_000),
        liquidCapital: 1_000_000,
        // An existing holder, so both the increment and the push credit paths run.
        shareholders: [{ nppId: countryNpps[c], shares: 500, avgCostPerShare: sharePrice }],
        ...(c === 0
          ? {
              pendingShareIssuance: { source: "ipo", issuedUpfront: true, remainingShares: 600 },
            }
          : {}),
      });
    }
  }
  db.seed("npps", npps);
  db.seed("corporations", corps);
  db.seed(
    "equityMarketPools",
    COUNTRIES.map((c, i) => ({
      _id: c.currency,
      cashLocal: 200_000 * (i + 1),
      targetCashLocal: 400_000,
      lifetime: {},
    }))
  );
  db.seed("exchangeRates", []);
  return db as unknown as Db;
}

/** Comparable state: every document with its wall-clock stamps dropped. */
async function snapshot(db: Db): Promise<Record<string, Doc[]>> {
  const out: Record<string, Doc[]> = {};
  for (const name of ["npps", "corporations", "equityMarketPools"]) {
    const docs = (await db.collection(name).find({}).toArray()) as Doc[];
    out[name] = docs
      .map(({ updatedAt, createdAt, ...rest }) => {
        void updatedAt;
        void createdAt;
        return rest;
      })
      .sort((a, b) => String(a._id).localeCompare(String(b._id)));
  }
  return out;
}

const TURN = 100;

describe("v6 stock-buy settlement", () => {
  it("conserves money per currency: NPP debits equal pool plus issuer credits", async () => {
    const db = buildFixture();
    const before = await snapshot(db);
    await investNppStockSurplus(db, TURN, null, undefined, undefined, true);
    const after = await snapshot(db);
    const trades = vi.mocked(nppBuyShares).mock.calls.length;
    expect(trades).toBeGreaterThan(20);

    const byId = (docs: Doc[]) => new Map(docs.map((d) => [String(d._id), d]));
    const nppBefore = byId(before.npps);
    const corpBefore = byId(before.corporations);
    const poolBefore = byId(before.equityMarketPools);
    for (const { id, currency } of COUNTRIES) {
      const debited = after.npps
        .filter((n) => n.countryId === id)
        .reduce(
          (sum, n) =>
            sum +
            ((nppBefore.get(String(n._id))!.nppInvestmentCashAnchor as number) -
              (n.nppInvestmentCashAnchor as number)),
          0
        );
      const issuer = after.corporations
        .filter((c) => c.countryId === id)
        .reduce(
          (sum, c) =>
            sum +
            ((c.liquidCapital as number) -
              (corpBefore.get(String(c._id))!.liquidCapital as number)),
          0
        );
      const pool =
        (after.equityMarketPools.find((p) => p._id === currency)!.cashLocal as number) -
        (poolBefore.get(currency)!.cashLocal as number);
      expect(debited).toBeGreaterThan(0);
      // Each trade rounds its debit and its credit to the cent separately.
      expect(Math.abs(debited - (pool + issuer))).toBeLessThanOrEqual(0.01 * trades);

      // Shares leave the float exactly as they reach holders.
      const floatDrop = after.corporations
        .filter((c) => c.countryId === id)
        .reduce(
          (sum, c) =>
            sum +
            ((corpBefore.get(String(c._id))!.publicFloat as number) - (c.publicFloat as number)),
          0
        );
      const held = (docs: Doc[]) =>
        docs
          .filter((c) => c.countryId === id)
          .flatMap((c) => c.shareholders as { shares: number }[])
          .reduce((sum, h) => sum + h.shares, 0);
      expect(held(after.corporations) - held(before.corporations)).toBe(floatDrop);
    }
  });

  it("ends in the state of a one-at-a-time replay that reads the pool per buy", async () => {
    vi.mocked(nppBuyShares).mockClear();
    const swept = buildFixture();
    await investNppStockSurplus(swept, TURN, null, undefined, undefined, true, 8);
    const calls = [...vi.mocked(nppBuyShares).mock.calls];
    expect(calls.length).toBeGreaterThan(20);

    // Replay the same buys in currency-partition order, one at a time, without
    // the preloaded pools (argument 8), so every buy reads its pool fresh.
    const replay = buildFixture();
    const order = COUNTRIES.map((c) => c.currency);
    const corpCurrency = (corpId: ObjectId) =>
      COUNTRIES[Math.floor(parseInt(corpId.toHexString().slice(2), 16) / 5)].currency;
    const ordered = [...calls].sort(
      (a, b) => order.indexOf(corpCurrency(a[2])) - order.indexOf(corpCurrency(b[2]))
    );
    const replayCorps = new Map(
      ((await replay.collection("corporations").find({}).toArray()) as Doc[]).map((c) => [
        String(c._id),
        c,
      ])
    );
    for (const [, npp, corpId, shares, homeRate, , preset] of ordered) {
      const corp = replayCorps.get(String(corpId))!;
      const result = await nppBuyShares(
        replay,
        npp,
        corpId,
        shares,
        homeRate,
        corp as never,
        preset
      );
      expect(result.ok).toBe(true);
      corp.publicFloat = (corp.publicFloat as number) - shares;
    }

    expect(await snapshot(swept)).toEqual(await snapshot(replay));
  });

  it("settles the same whether partitions run together or one at a time", async () => {
    const together = buildFixture();
    await investNppStockSurplus(together, TURN, null, undefined, undefined, true, 8);
    const apart = buildFixture();
    await investNppStockSurplus(apart, TURN, null, undefined, undefined, true, 1);
    expect(await snapshot(together)).toEqual(await snapshot(apart));
  });
});
