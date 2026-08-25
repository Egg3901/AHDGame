import { describe, it, expect, vi } from "vitest";
import { upsertBudgetDraft, tableBudget, resolveBudgetVote } from "./ukBudgets";
import type { UKBudget } from "../types/ukBudget";

/** In-memory ukBudgets + ukGovernment (for the confidence hit) fake. */
function fakeDb(seed?: Partial<UKBudget>) {
  const budgets: UKBudget[] = [];
  if (seed) budgets.push({ fiscalYear: 1953, status: "draft", ...seed } as UKBudget);
  const gov: { confidenceGauge?: number } = { confidenceGauge: 100 };

  const budgetsCol = {
    async findOne(f: { fiscalYear: number }) {
      return budgets.find((b) => b.fiscalYear === f.fiscalYear) ?? null;
    },
    async updateOne(
      f: { fiscalYear: number },
      u: { $set?: Partial<UKBudget>; $setOnInsert?: Partial<UKBudget> },
      opts?: { upsert?: boolean }
    ) {
      let b = budgets.find((x) => x.fiscalYear === f.fiscalYear);
      if (!b && opts?.upsert) {
        b = { fiscalYear: f.fiscalYear } as UKBudget;
        Object.assign(b, u.$setOnInsert);
        budgets.push(b);
      }
      if (b) Object.assign(b, u.$set);
    },
  };
  const govCol = {
    async findOne() {
      return gov;
    },
    async updateOne(_f: unknown, u: { $set: Record<string, unknown> }) {
      Object.assign(gov, u.$set);
    },
  };
  const collection = vi.fn((name: string) => (name === "ukBudgets" ? budgetsCol : govCol));
  return { db: { collection } as never, budgets, gov };
}

const valid = {
  taxRates: { "uk.tax.incomeTax": 25 },
  spendingAllocations: { healthcare: 50, defense: 50 },
};

describe("upsertBudgetDraft", () => {
  it("creates a draft", async () => {
    const { db, budgets } = fakeDb();
    const r = await upsertBudgetDraft(db, {
      fiscalYear: 1953,
      chancellorCharacterId: null,
      ...valid,
      now: new Date(),
    });
    expect(r.ok).toBe(true);
    expect(budgets[0].status).toBe("draft");
  });
  it("refuses to edit a tabled budget", async () => {
    const { db } = fakeDb({ status: "tabled", ...valid } as Partial<UKBudget>);
    const r = await upsertBudgetDraft(db, {
      fiscalYear: 1953,
      chancellorCharacterId: null,
      ...valid,
      now: new Date(),
    });
    expect(r.ok).toBe(false);
  });
});

describe("tableBudget", () => {
  it("tables a valid draft", async () => {
    const { db, budgets } = fakeDb({ status: "draft", ...valid } as Partial<UKBudget>);
    const r = await tableBudget(db, 1953, new Date());
    expect(r.ok).toBe(true);
    expect(budgets[0].status).toBe("tabled");
  });
  it("refuses to table an invalid budget", async () => {
    const { db } = fakeDb({
      status: "draft",
      taxRates: {},
      spendingAllocations: { healthcare: 40 }, // doesn't sum to 100
    } as Partial<UKBudget>);
    const r = await tableBudget(db, 1953, new Date());
    expect(r.ok).toBe(false);
  });
});

describe("resolveBudgetVote", () => {
  it("passes when for > against, no confidence hit", async () => {
    const { db, budgets, gov } = fakeDb({ status: "tabled", ...valid } as Partial<UKBudget>);
    const r = await resolveBudgetVote(db, {
      fiscalYear: 1953,
      votesFor: 330,
      votesAgainst: 300,
      now: new Date(),
    });
    expect(r.passed).toBe(true);
    expect(r.confidenceHit).toBe(false);
    expect(budgets[0].status).toBe("passed");
    expect(gov.confidenceGauge).toBe(100); // untouched
  });

  it("defeat sets status and fires the budgetDefeat confidence hit", async () => {
    const { db, budgets, gov } = fakeDb({ status: "tabled", ...valid } as Partial<UKBudget>);
    const r = await resolveBudgetVote(db, {
      fiscalYear: 1953,
      votesFor: 300,
      votesAgainst: 330,
      now: new Date(),
    });
    expect(r.passed).toBe(false);
    expect(r.confidenceHit).toBe(true);
    expect(budgets[0].status).toBe("defeated");
    expect(gov.confidenceGauge).toBeLessThan(100); // gauge dented
  });

  it("refuses to resolve a budget that isn't tabled", async () => {
    const { db } = fakeDb({ status: "draft", ...valid } as Partial<UKBudget>);
    const r = await resolveBudgetVote(db, {
      fiscalYear: 1953,
      votesFor: 1,
      votesAgainst: 0,
      now: new Date(),
    });
    expect(r.ok).toBe(false);
  });
});
