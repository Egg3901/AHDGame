// Regression for #1975: Greece federal surplus source drifted by a recurring
// per-turn offset because processFiscalBaseGrowth recomputed revenue off the
// grown tax bases without persisting the surplus cache. Drives the real
// refresh/subsidy/fiscalBaseGrowth turn sequence with the 1953-default Greece
// seed across consecutive turns and asserts the triple invariant
// surplus === revenue.total - spending.total holds every turn while revenue
// still grows.
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { refreshNationalBudgetRevenue } from "@/lib/budget/revenue";
import { processSubsidyBudget } from "@/lib/turn/subsidyBudgetTurn";
import { processFiscalBaseGrowth } from "@/lib/turn/fiscalBaseGrowth";
import { checkFederalBudgetInvariants } from "@/lib/budget/budgetInvariants";
import { resetCorpFxRateCacheForTests } from "@/lib/currency/corporationCapital";
import type { FederalBudget } from "@/lib/db/types/budget";
import {
  getInitialNationalBudgetsForPreset,
  generateDefaultEnactedLaws,
} from "@/lib/seeds/reference/budgets";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

// Minimal stateful in-memory mongo fake: equality, dotted paths,
// $in/$nin/$ne, $exists, $gt/$gte/$lt/$lte, $or, $set/$inc/$unset,
// bulkWrite, projection.
type Doc = Record<string, unknown>;

function getPath(doc: Doc, path: string): unknown {
  let cur: unknown = doc;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Doc)[part];
  }
  return cur;
}

function setPath(doc: Doc, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: Doc = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    const v = cur[parts[i]];
    if (v == null || typeof v !== "object") cur[parts[i]] = {};
    cur = cur[parts[i]] as Doc;
  }
  cur[parts[parts.length - 1]] = value;
}

function matchOp(value: unknown, op: string, operand: unknown): boolean {
  switch (op) {
    case "$in":
      return (
        Array.isArray(operand) && operand.some((o) => JSON.stringify(o) === JSON.stringify(value))
      );
    case "$nin":
      return (
        Array.isArray(operand) && !operand.some((o) => JSON.stringify(o) === JSON.stringify(value))
      );
    case "$ne":
      return JSON.stringify(value ?? null) !== JSON.stringify(operand ?? null);
    case "$exists":
      return (value !== undefined) === Boolean(operand);
    case "$gt":
      return (value as number) > (operand as number);
    case "$gte":
      return (value as number) >= (operand as number);
    case "$lt":
      return (value as number) < (operand as number);
    case "$lte":
      return (value as number) <= (operand as number);
    default:
      throw new Error(`test fake: unsupported op ${op}`);
  }
}

function matches(doc: Doc, filter: Doc): boolean {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === "$or") {
      if (!Array.isArray(cond) || !cond.some((f) => matches(doc, f as Doc))) return false;
      continue;
    }
    const value = getPath(doc, key);
    if (cond != null && typeof cond === "object" && !Array.isArray(cond)) {
      const ops = Object.entries(cond as Doc).filter(([k]) => k.startsWith("$"));
      if (ops.length > 0) {
        if (!ops.every(([op, operand]) => matchOp(value, op, operand))) return false;
        continue;
      }
    }
    if (JSON.stringify(value) !== JSON.stringify(cond)) return false;
  }
  return true;
}

function cloneDoc(d: Doc): Doc {
  // structuredClone chokes on ObjectId (seeded law _ids); laws are read-only
  // here so a string _id is faithful enough.
  const out: Doc = { ...d };
  if (out._id != null && typeof out._id === "object") out._id = String(out._id);
  for (const [k, v] of Object.entries(out)) {
    if (v instanceof Date) out[k] = new Date(v);
    else if (v != null && typeof v === "object" && (v as object).constructor === Object)
      out[k] = cloneDoc(v as Doc);
  }
  return out;
}

function applyProjection(doc: Doc, projection: Doc): Doc {
  const vals = Object.values(projection);
  if (vals.some((v) => v === 0)) return cloneDoc(doc); // exclusion: return whole
  const out: Doc = {};
  if (projection._id !== 0) out._id = doc._id;
  for (const [k, v] of Object.entries(projection)) {
    if (v && k !== "_id") {
      const val = getPath(doc, k);
      if (val !== undefined) setPath(out, k, cloneDoc(val as Doc));
    }
  }
  return out;
}

function applyUpdate(doc: Doc, update: Doc): void {
  if (update.$set) for (const [k, v] of Object.entries(update.$set as Doc)) setPath(doc, k, v);
  if (update.$inc)
    for (const [k, v] of Object.entries(update.$inc as Doc))
      setPath(doc, k, ((getPath(doc, k) as number) ?? 0) + (v as number));
  if (update.$unset) {
    for (const k of Object.keys(update.$unset as Doc)) {
      const parts = k.split(".");
      let cur: unknown = doc;
      for (let i = 0; i < parts.length - 1; i++) cur = (cur as Doc)?.[parts[i]];
      if (cur != null && typeof cur === "object") delete (cur as Doc)[parts[parts.length - 1]];
    }
  }
}

function makeFakeDb(seed: Record<string, Doc[]>): Db {
  const store: Record<string, Doc[]> = Object.fromEntries(
    Object.entries(seed).map(([k, arr]) => [k, arr.map((d) => cloneDoc(d))])
  );
  const coll = (name: string) => {
    store[name] ??= [];
    const docs = store[name];
    const cursor = (rows: Doc[]) => {
      let proj: Doc | null = null;
      const c = {
        toArray: async () => rows.map((d) => (proj ? applyProjection(d, proj) : cloneDoc(d))),
        sort: () => c,
        limit: () => c,
        skip: () => c,
        project: (p: Doc) => {
          proj = p;
          return c;
        },
        next: async () => (rows.length > 0 ? rows[0] : null),
        [Symbol.asyncIterator]: async function* () {
          for (const d of rows) yield d;
        },
      };
      return c;
    };
    return {
      find: (filter: Doc = {}, opts?: { projection?: Doc }) => {
        const rows = docs.filter((d) => matches(d, filter));
        const c = cursor(rows);
        if (opts?.projection) c.project(opts.projection);
        return c;
      },
      findOne: async (filter: Doc = {}, opts?: { projection?: Doc }) => {
        const d = docs.find((x) => matches(x, filter));
        if (!d) return null;
        return opts?.projection ? applyProjection(d, opts.projection) : cloneDoc(d);
      },
      updateOne: async (filter: Doc, update: Doc) => {
        const d = docs.find((x) => matches(x, filter));
        if (!d) return { matchedCount: 0, modifiedCount: 0 };
        applyUpdate(d, update);
        return { matchedCount: 1, modifiedCount: 1 };
      },
      updateMany: async (filter: Doc, update: Doc) => {
        let n = 0;
        for (const d of docs.filter((x) => matches(x, filter))) {
          applyUpdate(d, update);
          n++;
        }
        return { matchedCount: n, modifiedCount: n };
      },
      bulkWrite: async (ops: { updateOne: { filter: Doc; update: Doc } }[]) => {
        for (const op of ops) {
          const d = docs.find((x) => matches(x, op.updateOne.filter));
          if (d) applyUpdate(d, op.updateOne.update);
        }
        return { ok: 1 };
      },
      insertOne: async (d: Doc) => {
        docs.push(cloneDoc(d));
        return { insertedId: d._id };
      },
      insertMany: async (arr: Doc[]) => {
        for (const d of arr) docs.push(cloneDoc(d));
        return { insertedIds: {} };
      },
      countDocuments: async (filter: Doc = {}) => docs.filter((d) => matches(d, filter)).length,
    };
  };
  return {
    collection: ((name: string) => coll(name)) as unknown as Db["collection"],
  } as unknown as Db;
}

describe("fiscalBaseGrowth surplus seam (#1975)", () => {
  it("holds surplus === revenue.total - spending.total across consecutive turns", async () => {
    resetCorpFxRateCacheForTests();
    const grSeed = getInitialNationalBudgetsForPreset("1953-default").find(
      (b) => b.countryId === "GR"
    );
    expect(grSeed).toBeDefined();
    const grLaws = generateDefaultEnactedLaws("1953-default").filter(
      (l) => (l as unknown as Doc).countryId === "GR"
    );
    // GR regions: gdp in MILLIONS, summing to the ~50B seed GDP.
    const states: Doc[] = [
      { _id: "GR_ATT", countryId: "GR", population: 3_000_000, gdp: 20000 },
      { _id: "GR_MAC", countryId: "GR", population: 2_000_000, gdp: 15000 },
      { _id: "GR_REST", countryId: "GR", population: 2_600_000, gdp: 15000 },
    ];
    const metrics: Doc[] = states.map((s) => ({
      _id: s._id,
      countryId: "GR",
      economic: {
        wageGrowth: { value: 6 },
        tradeGrowth: { value: 8 },
        gdpGrowth: { value: 7 },
      },
    }));
    const db = makeFakeDb({
      federalBudget: [grSeed as unknown as Doc],
      enactedLaws: grLaws as unknown as Doc[],
      states,
      macroMetrics: metrics,
      gameConfig: [],
      gameState: [],
      countryGameStates: [],
      corporations: [],
      corporateSectors: [],
      subsidies: [],
      exchangeRates: [],
    });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db);

    const initial = (await db
      .collection<FederalBudget>("federalBudget")
      .findOne({ _id: "GR" })) as unknown as {
      revenue: { total: number };
    };
    const initialRevenue = initial.revenue.total;

    for (let turn = 1; turn <= 4; turn++) {
      await refreshNationalBudgetRevenue(db);
      await processSubsidyBudget(db);
      await processFiscalBaseGrowth(turn);
      const doc = (await db
        .collection<FederalBudget>("federalBudget")
        .findOne({ _id: "GR" })) as unknown as {
        revenue: { total: number };
        spending: { total: number };
        surplus: number;
      };
      expect(checkFederalBudgetInvariants(doc)).toEqual([]);
      expect(doc.surplus).toBe(doc.revenue.total - doc.spending.total);
    }
    const final = (await db
      .collection<FederalBudget>("federalBudget")
      .findOne({ _id: "GR" })) as unknown as {
      revenue: { total: number };
    };
    // Growth still occurs: revenue moves up off the 1953 seed.
    expect(final.revenue.total).toBeGreaterThan(initialRevenue);
  });
});
