import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import type { DefenceContract } from "@/lib/db/types/defenceContract";
import type { HealPlan } from "../types";
import {
  defect,
  findProcurementClawbacks,
  procurementClawbackMoveKey,
} from "./AHD-defence-procurement-overaward";

function contract(input: {
  lots: number;
  turn: number;
  corporationId: ObjectId;
  clawedBack?: number;
}): DefenceContract {
  return {
    _id: new ObjectId(),
    countryId: "US",
    corporationId: input.corporationId,
    sectorId: new ObjectId(),
    component: "ground",
    lotsOrdered: input.lots,
    lotsDelivered: input.lots,
    pricePerLot: 372_025_176,
    status: "complete",
    awardedTurn: input.turn,
    administrativeClawbackLots: input.clawedBack,
  };
}

describe("findProcurementClawbacks", () => {
  it("recognizes only one supplier tranche in each contracting window", () => {
    const supplier = new ObjectId();
    const contracts = [
      contract({ lots: 6, turn: 96, corporationId: supplier }),
      contract({ lots: 6, turn: 96, corporationId: supplier }),
      contract({ lots: 5, turn: 96, corporationId: supplier }),
      contract({ lots: 5, turn: 96, corporationId: supplier }),
      contract({ lots: 20, turn: 96, corporationId: supplier }),
      contract({ lots: 11, turn: 116, corporationId: supplier }),
    ];

    const rows = findProcurementClawbacks(contracts, new Map([["US", 65_081_000_000]]));

    expect(rows.reduce((sum, row) => sum + row.excessLots, 0)).toBe(41);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(15_253_032_216);
  });

  it("is a no-op after the excess lots have already been recovered", () => {
    const supplier = new ObjectId();
    const rows = findProcurementClawbacks(
      [contract({ lots: 10, turn: 96, corporationId: supplier, clawedBack: 4 })],
      new Map([["US", 65_081_000_000]])
    );
    expect(rows).toEqual([]);
  });
});

/**
 * Minimal document store, enough for the operators the clawback uses.
 *
 * Written rather than mocked because the properties under test ARE the write semantics: a
 * guarded debit that does not match must not apply, and a duplicate `_id` must lose.
 */
type Doc = Record<string, unknown>;

function get(doc: Doc, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, k) => (cur as Doc | undefined)?.[k], doc);
}

function set(doc: Doc, path: string, value: unknown): void {
  const keys = path.split(".");
  let cur = doc;
  for (const key of keys.slice(0, -1)) {
    if (typeof cur[key] !== "object" || cur[key] === null) cur[key] = {};
    cur = cur[key] as Doc;
  }
  cur[keys[keys.length - 1]] = value;
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId || b instanceof ObjectId) return String(a) === String(b);
  return a === b;
}

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    const actual = get(doc, key);
    if (cond && typeof cond === "object" && !(cond instanceof ObjectId)) {
      const c = cond as Doc;
      if ("$gte" in c) return typeof actual === "number" && actual >= (c.$gte as number);
      if ("$ne" in c) return !same(actual, c.$ne);
      if ("$type" in c) return c.$type === "number" ? typeof actual === "number" : actual != null;
    }
    return same(actual, cond);
  });
}

function memoryDb(seed: Record<string, Doc[]>) {
  const store: Record<string, Doc[]> = { ...seed };
  const collection = (name: string) => {
    store[name] ??= [];
    const rows = () => store[name];
    return {
      find: (filter: Doc = {}) => ({
        toArray: async () => rows().filter((d) => matches(d, filter)),
      }),
      findOne: async (filter: Doc = {}) => rows().find((d) => matches(d, filter)) ?? null,
      insertOne: async (doc: Doc) => {
        if (rows().some((d) => same(d._id, doc._id))) {
          throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
        }
        rows().push({ ...doc });
        return { insertedId: doc._id };
      },
      updateOne: async (filter: Doc, update: Doc) => {
        const doc = rows().find((d) => matches(d, filter));
        if (!doc) return { matchedCount: 0, modifiedCount: 0 };
        for (const [path, delta] of Object.entries((update.$inc ?? {}) as Doc)) {
          set(doc, path, ((get(doc, path) as number) ?? 0) + (delta as number));
        }
        for (const [path, value] of Object.entries((update.$set ?? {}) as Doc)) {
          set(doc, path, value);
        }
        return { matchedCount: 1, modifiedCount: 1 };
      },
    };
  };
  return { db: { collection } as unknown as Db, store };
}

describe("procurement clawback settlement", () => {
  const CORP = new ObjectId();
  const CONTRACT = new ObjectId();

  function world(corpCash = 5_000) {
    return memoryDb({
      corporations: [{ _id: CORP, liquidCapital: corpCash }],
      federalBudget: [{ countryId: "US", defenseAppropriation: { balance: 1_000 } }],
      defenceContracts: [{ _id: CONTRACT, countryId: "US", corporationId: CORP }],
    });
  }

  const healPlan = {
    affected: 1,
    touched: [],
    moneyDelta: 0,
    summary: "",
    payload: {
      clawbacks: [
        {
          contractId: CONTRACT.toString(),
          corporationId: CORP.toString(),
          countryId: "US",
          excessLots: 2,
          amount: 4_000,
          recoverableAmount: 4_000,
          unrecoveredAmount: 0,
        },
      ],
      corporationIds: [CORP.toString()],
      budgetIds: ["b1"],
      totalAmount: 4_000,
      recoverableAmount: 4_000,
      unrecoveredAmount: 0,
      missing: [],
    },
  } as unknown as HealPlan;

  it("recovers as one keyed, net-zero move and conserves money", async () => {
    const { db, store } = world();

    await defect.apply(db, healPlan, {
      env: "sandbox" as const,
      dryRun: false,
      now: new Date(),
      runId: "run_a",
    });

    expect(store.corporations[0].liquidCapital).toBe(1_000);
    expect((store.federalBudget[0].defenseAppropriation as Doc).balance).toBe(5_000);
    expect(store.bankMoneyMoves).toHaveLength(1);
    expect(store.bankMoneyMoves[0]._id).toBe(
      procurementClawbackMoveKey("run_a", CONTRACT.toString())
    );
    expect(store.bankMoneyMoves[0].status).toBe("applied");
    expect(store.defenceContracts[0].administrativeClawbackLots).toBe(2);
  });

  it("replays instead of debiting the supplier twice", async () => {
    const { db, store } = world();
    const ctx = { env: "sandbox" as const, dryRun: false, now: new Date(), runId: "run_a" };

    await defect.apply(db, healPlan, ctx);
    await defect.apply(db, healPlan, ctx);

    expect(store.corporations[0].liquidCapital).toBe(1_000);
    expect((store.federalBudget[0].defenseAppropriation as Doc).balance).toBe(5_000);
    expect(store.defenceContracts[0].administrativeClawbackLots).toBe(2);
  });

  it("moves nothing when the supplier cannot fund the approved recovery", async () => {
    const { db, store } = world(10);

    await expect(
      defect.apply(db, healPlan, {
        env: "sandbox" as const,
        dryRun: false,
        now: new Date(),
        runId: "run_a",
      })
    ).rejects.toThrow(/did not settle/);

    expect(store.corporations[0].liquidCapital).toBe(10);
    expect((store.federalBudget[0].defenseAppropriation as Doc).balance).toBe(1_000);
    expect(store.defenceContracts[0].administrativeClawbackLots).toBeUndefined();
  });

  it("refuses to move unkeyed money when there is no run id", async () => {
    const { db, store } = world();

    await expect(
      defect.apply(db, healPlan, { env: "sandbox" as const, dryRun: false, now: new Date() })
    ).rejects.toThrow(/run id/);

    expect(store.corporations[0].liquidCapital).toBe(5_000);
  });
});
