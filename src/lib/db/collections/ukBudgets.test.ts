import { describe, it, expect, vi } from "vitest";
import {
  upsertBudgetDraft,
  tableBudget,
  ensureBudgetDraftForFiscalYear,
  applyBudgetOutcome,
  createBudgetBill,
  tableBudgetWithBill,
} from "./ukBudgets";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { UKBudget } from "../types/ukBudget";

/** In-memory ukBudgets + ukGovernment (for the confidence hit) fake. */
function fakeDb(seed?: Partial<UKBudget>, confidenceGauge = 100) {
  const budgets: UKBudget[] = [];
  if (seed) budgets.push({ fiscalYear: 1953, status: "draft", ...seed } as UKBudget);
  const gov: { confidenceGauge?: number } = { confidenceGauge };

  const budgetsCol = {
    async findOne(f: { fiscalYear: number }) {
      return budgets.find((b) => b.fiscalYear === f.fiscalYear) ?? null;
    },
    async updateOne(
      f: { fiscalYear: number; status?: UKBudget["status"] },
      u: { $set?: Partial<UKBudget>; $setOnInsert?: Partial<UKBudget> },
      opts?: { upsert?: boolean }
    ) {
      let b = budgets.find(
        (x) => x.fiscalYear === f.fiscalYear && (!f.status || x.status === f.status)
      );
      if (!b && opts?.upsert) {
        b = { fiscalYear: f.fiscalYear } as UKBudget;
        Object.assign(b, u.$setOnInsert);
        budgets.push(b);
      }
      if (b) Object.assign(b, u.$set);
      return { matchedCount: b ? 1 : 0 };
    },
    async insertOne(doc: UKBudget) {
      budgets.push(doc);
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
  return { db: { collection } as unknown as Db, budgets, gov };
}

const valid = {
  taxRates: { "uk.tax.incomeTax": 25 },
  programLevels: { "uk.defense.armedForces.primary": 1 },
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
    expect(budgets[0].programLevels).toEqual(valid.programLevels);
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

describe("ensureBudgetDraftForFiscalYear", () => {
  it("creates a draft when none exists", async () => {
    const { db, budgets } = fakeDb();
    const created = await ensureBudgetDraftForFiscalYear(db, 1954, new Date());
    expect(created).toBe(true);
    expect(budgets[0]).toMatchObject({ fiscalYear: 1954, status: "draft" });
  });
  it("is a no-op when a budget already exists", async () => {
    const { db, budgets } = fakeDb({ status: "tabled", fiscalYear: 1953 } as Partial<UKBudget>);
    const created = await ensureBudgetDraftForFiscalYear(db, 1953, new Date());
    expect(created).toBe(false);
    expect(budgets).toHaveLength(1);
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
      programLevels: { "uk.defense.armedForces.primary": 9 },
    } as Partial<UKBudget>);
    const r = await tableBudget(db, 1953, new Date());
    expect(r.ok).toBe(false);
  });
});

describe("createBudgetBill", () => {
  it("inserts a votable commons bill linked to the fiscal year", async () => {
    let inserted: Record<string, unknown> | null = null;
    const insertedId = new ObjectId();
    const db = {
      collection: () => ({
        insertOne: async (doc: Record<string, unknown>) => {
          inserted = doc;
          return { insertedId };
        },
      }),
    } as never;
    const id = await createBudgetBill(db, {
      fiscalYear: 1953,
      chancellorCharacterId: null,
      chancellorName: null,
      chancellorParty: null,
      currentTurn: 100,
      now: new Date("2026-01-01"),
      provisions: [
        {
          legislationTypeId: "uk.tax.incomeTax",
          policyOptionId: "rate:50",
          proposedRate: 50,
          effectDirection: 1,
        },
      ],
    });
    expect(id).toBe(insertedId);
    expect(inserted).toMatchObject({
      countryId: "UK",
      currentChamber: "commons",
      status: "active",
      category: "budget",
      budgetFiscalYear: 1953,
      adminProposed: true, // no chancellor
      votingEndsOnTurn: 124,
      provisions: [
        expect.objectContaining({
          legislationTypeId: "uk.tax.incomeTax",
          proposedRate: 50,
        }),
      ],
    });
  });
});

describe("tableBudgetWithBill", () => {
  it("restores the draft when bill creation fails cleanly", async () => {
    const { db, budgets } = fakeDb({ status: "draft", ...valid } as Partial<UKBudget>);
    const originalCollection = db.collection;
    db.collection = vi.fn((name: string) => {
      if (name !== "bills") return originalCollection(name);
      return {
        insertOne: vi.fn().mockRejectedValue(new Error("insert failed")),
        findOne: vi.fn().mockResolvedValue(null),
      };
    }) as never;

    await expect(
      tableBudgetWithBill(db, {
        fiscalYear: 1953,
        chancellorCharacterId: null,
        chancellorName: null,
        chancellorParty: null,
        currentTurn: 100,
        now: new Date("2026-01-01"),
        provisions: [
          {
            legislationTypeId: "uk.tax.incomeTax",
            policyOptionId: "rate:50",
            proposedRate: 50,
            effectDirection: 1,
          },
        ],
      })
    ).rejects.toThrow("insert failed");
    expect(budgets[0]).toMatchObject({ status: "draft" });
    expect(budgets[0].tabledAt).toBeNull();
  });
});

describe("applyBudgetOutcome", () => {
  it("a passed Budget restores government confidence once", async () => {
    const { db, gov } = fakeDb({ status: "tabled", ...valid } as Partial<UKBudget>, 50);
    await applyBudgetOutcome(db, { fiscalYear: 1953, passed: true, now: new Date() });
    expect(gov.confidenceGauge).toBe(60);
  });
  it("mirrors an explicit pass with no confidence hit", async () => {
    const { db, budgets, gov } = fakeDb({ status: "tabled", ...valid } as Partial<UKBudget>);
    const r = await applyBudgetOutcome(db, { fiscalYear: 1953, passed: true, now: new Date() });
    expect(r.passed).toBe(true);
    expect(budgets[0].status).toBe("passed");
    expect(gov.confidenceGauge).toBe(100);
  });
  it("mirrors an explicit defeat and fires the confidence hit", async () => {
    const { db, budgets, gov } = fakeDb({ status: "tabled", ...valid } as Partial<UKBudget>);
    const r = await applyBudgetOutcome(db, { fiscalYear: 1953, passed: false, now: new Date() });
    expect(r.confidenceHit).toBe(true);
    expect(budgets[0].status).toBe("defeated");
    expect(gov.confidenceGauge).toBeLessThan(100);
  });
  it("is idempotent once resolved (guards on tabled)", async () => {
    const { db } = fakeDb({ status: "passed", ...valid } as Partial<UKBudget>);
    const r = await applyBudgetOutcome(db, { fiscalYear: 1953, passed: false, now: new Date() });
    expect(r.ok).toBe(false);
  });
});
