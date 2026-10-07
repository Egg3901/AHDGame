import { ObjectId, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import * as settlementJournal from "@/lib/banking/settlementJournal";
import type { CorpSnapshot } from "./types";
import { settleCorporateOperatingCash } from "./operatingCashSettlement";

const COUNTRIES = ["US", "GB", "FR"] as const;

/** Every Mongo command waits a fixed latency, like the remote multiplayer database. */
function withLatency(db: ReturnType<typeof createInMemoryDb>, latencyMs: number) {
  const stats = { commands: 0, inFlight: 0, maxInFlight: 0, writesAfter: 0, stopped: false };
  const delayed = <T>(value: () => T): Promise<Awaited<T>> => {
    stats.commands++;
    if (stats.stopped) stats.writesAfter++;
    stats.inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    return new Promise((resolve, reject) =>
      setTimeout(() => {
        stats.inFlight--;
        Promise.resolve()
          .then(value)
          .then((result) => resolve(result as Awaited<T>), reject);
      }, latencyMs)
    );
  };
  const wrapCollection = (name: string) => {
    const collection = db.collection(name) as unknown as Record<string, unknown>;
    return new Proxy(collection, {
      get(target, prop, receiver) {
        const member = Reflect.get(target, prop, receiver);
        if (typeof member !== "function") return member;
        if (prop === "find" || prop === "aggregate") {
          return (...args: unknown[]) => {
            const cursor = (member as (...a: unknown[]) => { toArray(): Promise<unknown[]> }).apply(
              target,
              args
            );
            return new Proxy(cursor, {
              get(cursorTarget, cursorProp, cursorReceiver) {
                const cursorMember = Reflect.get(cursorTarget, cursorProp, cursorReceiver);
                if (cursorProp === "toArray") {
                  return () => delayed(() => cursorTarget.toArray());
                }
                return typeof cursorMember === "function"
                  ? cursorMember.bind(cursorTarget)
                  : cursorMember;
              },
            });
          };
        }
        return (...args: unknown[]) =>
          delayed(() => (member as (...a: unknown[]) => unknown).apply(target, args));
      },
    });
  };
  const proxied = new Proxy(db as unknown as Record<string, unknown>, {
    get(target, prop, receiver) {
      if (prop === "collection") return (name: string) => wrapCollection(name);
      return Reflect.get(target, prop, receiver);
    },
  });
  return { db: proxied as unknown as Db, stats };
}

function snapshot(corpId: ObjectId, index: number): CorpSnapshot {
  const country = COUNTRIES[index % COUNTRIES.length];
  const loss = index % 25 === 0;
  return {
    corpId,
    operatingCashIncomeLocal: loss ? -40 : 80,
    operatingCashCurrency: "USD",
    operatingCashLocalPerAnchor: 1,
    federalTaxByCountryAnchor: new Map(loss ? [] : [[country, 20]]),
  } as unknown as CorpSnapshot;
}

function seedWorld(corpCount: number) {
  const db = createInMemoryDb();
  db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
  db.seed("gameState", [{ _id: "current", currentTurn: 13, preset: "2019-default" }]);
  db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
  db.seed(
    "federalBudget",
    COUNTRIES.map((country) => ({
      _id: country,
      countryId: country,
      currencyCode: "USD",
      treasuryCashLocal: 0,
      treasuryBalance: 0,
    }))
  );
  const ids = Array.from(
    { length: corpCount },
    (_, i) => new ObjectId(`65${i.toString(16).padStart(22, "0")}`)
  );
  db.seed(
    "corporations",
    ids.map((id) => ({ _id: id, liquidCapital: 10 }))
  );
  return { db, snapshots: ids.map((id, i) => snapshot(id, i)) };
}

function outcome(db: ReturnType<typeof createInMemoryDb>) {
  const corporations = db
    .collection("corporations")
    .docs.map((corp) => [String(corp._id), corp.liquidCapital, corp.operatingCashArrearsByCurrency])
    .sort();
  const budgets = db
    .collection("federalBudget")
    .docs.map((row) => [row._id, row.treasuryCashLocal, row.treasuryBalance])
    .sort();
  const journals = db
    .collection("bankMoneyMoves")
    .docs.map((row) => [row._id, row.status])
    .sort();
  return { corporations, budgets, journals };
}

describe("corporate operating cash settlement lanes", () => {
  it("serializes legacy recovery even when no current Treasury destinations are known", async () => {
    const { db, snapshots } = seedWorld(3);
    const input = snapshots.map((row) => ({ ...row, federalTaxByCountryAnchor: new Map() }));
    db.seed(
      "bankMoneyMoves",
      input.map((row) => ({
        _id: `corp-operating-cash:13:${row.corpId.toString()}`,
      }))
    );
    let active = 0;
    let peak = 0;
    const resume = vi
      .spyOn(settlementJournal, "resumeSettlement")
      .mockImplementation(async (_db, key) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return {
          status: "applied",
          key,
          appliedLegs: [],
          appliedProjections: [],
          newlyAppliedProjections: [],
        };
      });
    try {
      await settleCorporateOperatingCash(db as unknown as Db, input, 13, new Date(0));
      expect(resume).toHaveBeenCalledTimes(3);
      expect(peak).toBe(1);
    } finally {
      resume.mockRestore();
    }
  });

  it("settles a full corporate turn in overlapping lanes with the sequential outcome", async () => {
    const corpCount = 150;
    const sequentialWorld = seedWorld(corpCount);
    const sequential = withLatency(sequentialWorld.db, 1);
    const sequentialStart = performance.now();
    await settleCorporateOperatingCash(
      sequential.db,
      sequentialWorld.snapshots,
      13,
      new Date(0),
      1
    );
    const sequentialMs = performance.now() - sequentialStart;

    const laneWorld = seedWorld(corpCount);
    const laned = withLatency(laneWorld.db, 1);
    const laneStart = performance.now();
    await settleCorporateOperatingCash(laned.db, laneWorld.snapshots, 13, new Date(0));
    const laneMs = performance.now() - laneStart;

    console.info(
      `[operating-cash lanes] corps=${corpCount} commands sequential=${sequential.stats.commands} ` +
        `laned=${laned.stats.commands} wall sequential=${sequentialMs.toFixed(0)}ms ` +
        `laned=${laneMs.toFixed(0)}ms maxInFlight=${laned.stats.maxInFlight}`
    );
    expect(outcome(laneWorld.db)).toEqual(outcome(sequentialWorld.db));
    expect(
      laneWorld.db.collection("bankMoneyMoves").docs.every((row) => row.status === "applied")
    ).toBe(true);
    // Same work, not less of it: the gain is overlap, not skipped receipts.
    expect(laned.stats.commands).toBe(sequential.stats.commands);
    expect(laned.stats.maxInFlight).toBeGreaterThan(1);
    expect(laneMs).toBeLessThan(sequentialMs / 2);
    // Every taxed corporation pays its Treasury exactly once.
    const taxed = laneWorld.snapshots.filter((s) => (s.federalTaxByCountryAnchor?.size ?? 0) > 0);
    const totalTreasury = laneWorld.db
      .collection("federalBudget")
      .docs.reduce((sum, row) => sum + Number(row.treasuryCashLocal), 0);
    expect(totalTreasury).toBe(taxed.length * 20);
  }, 120_000);

  it("drains in-flight corporations and starts no new ones after a failure", async () => {
    const { db: world, snapshots } = seedWorld(40);
    const broken = { ...snapshots[5], operatingCashLocalPerAnchor: Number.NaN } as CorpSnapshot;
    const input = [...snapshots.slice(0, 5), broken, ...snapshots.slice(6)];
    const { db, stats } = withLatency(world, 1);
    await expect(settleCorporateOperatingCash(db, input, 13, new Date(0))).rejects.toThrow(
      /Missing frozen operating cash quote/
    );
    stats.stopped = true;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stats.writesAfter).toBe(0);
    expect(stats.inFlight).toBe(0);
    const journals = world.collection("bankMoneyMoves").docs;
    // Later corporations were never started once the failure was seen.
    expect(journals.some((row) => String(row._id).includes(String(snapshots[39].corpId)))).toBe(
      false
    );
    expect(journals.every((row) => row.status === "applied")).toBe(true);
  }, 60_000);

  it("settles a corporation listed twice once, in input order", async () => {
    const { db: world, snapshots } = seedWorld(3);
    const { db } = withLatency(world, 1);
    await settleCorporateOperatingCash(
      db,
      [snapshots[1], snapshots[1], snapshots[2]],
      13,
      new Date(0)
    );
    const corp = world
      .collection("corporations")
      .docs.find((row) => String(row._id) === String(snapshots[1].corpId));
    expect(corp?.liquidCapital).toBe(10 + 80);
    const budgets = world.collection("federalBudget").docs;
    expect(budgets.reduce((sum, row) => sum + Number(row.treasuryCashLocal), 0)).toBe(40);
  }, 60_000);
});
