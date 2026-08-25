import { describe, it, expect, vi } from "vitest";
import { getNhsQuality, tickNhsFromBudget } from "./nhsStore";
import { NHS_QUALITY_START, NHS_BASELINE_HEALTHCARE_SHARE } from "./nhsQuality";

/** In-memory ukBudgets + ukNhsState fake. */
function fakeDb(opts: { budget?: unknown; nhsQuality?: number } = {}) {
  const nhs: { quality?: number; lastHealthcareShare?: number } =
    opts.nhsQuality !== undefined ? { quality: opts.nhsQuality } : {};
  const budgets = opts.budget ? [opts.budget] : [];
  const collection = vi.fn((name: string) => {
    if (name === "ukBudgets") {
      return {
        async findOne(f: { fiscalYear: number }) {
          return (
            (budgets as { fiscalYear: number }[]).find((b) => b.fiscalYear === f.fiscalYear) ?? null
          );
        },
      };
    }
    return {
      async findOne() {
        return "quality" in nhs ? nhs : null;
      },
      async updateOne(_f: unknown, u: { $set: Record<string, unknown> }) {
        Object.assign(nhs, u.$set);
      },
    };
  });
  return { db: { collection } as never, nhs };
}

describe("getNhsQuality", () => {
  it("defaults to the start value when unset", async () => {
    const { db } = fakeDb();
    expect(await getNhsQuality(db)).toBe(NHS_QUALITY_START);
  });
  it("reads the stored value", async () => {
    const { db } = fakeDb({ nhsQuality: 42 });
    expect(await getNhsQuality(db)).toBe(42);
  });
});

describe("tickNhsFromBudget", () => {
  it("rises when a passed Budget funds healthcare above baseline", async () => {
    const { db, nhs } = fakeDb({
      nhsQuality: 60,
      budget: { fiscalYear: 1953, status: "passed", spendingAllocations: { healthcare: 40 } },
    });
    const q = await tickNhsFromBudget(db, { fiscalYear: 1953, now: new Date() });
    expect(q).toBeGreaterThan(60); // 40% >> 18% baseline → target high → quality climbs
    expect(nhs.quality).toBe(q);
    expect(nhs.lastHealthcareShare).toBe(40);
  });

  it("falls when a passed Budget underfunds healthcare", async () => {
    const { db } = fakeDb({
      nhsQuality: 60,
      budget: { fiscalYear: 1953, status: "passed", spendingAllocations: { healthcare: 4 } },
    });
    const q = await tickNhsFromBudget(db, { fiscalYear: 1953, now: new Date() });
    expect(q).toBeLessThan(60);
  });

  it("uses the neutral baseline when no passed Budget exists", async () => {
    const { db, nhs } = fakeDb({ nhsQuality: 60 }); // no budget
    await tickNhsFromBudget(db, { fiscalYear: 1953, now: new Date() });
    expect(nhs.lastHealthcareShare).toBe(NHS_BASELINE_HEALTHCARE_SHARE);
  });

  it("ignores an unpassed (draft/tabled) Budget", async () => {
    const { db, nhs } = fakeDb({
      nhsQuality: 60,
      budget: { fiscalYear: 1953, status: "tabled", spendingAllocations: { healthcare: 40 } },
    });
    await tickNhsFromBudget(db, { fiscalYear: 1953, now: new Date() });
    expect(nhs.lastHealthcareShare).toBe(NHS_BASELINE_HEALTHCARE_SHARE); // not the tabled 40
  });
});
