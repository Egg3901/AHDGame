import { describe, it, expect, vi } from "vitest";
import { getNhsQuality, tickNhsFromBudget } from "./nhsStore";
import { NHS_QUALITY_START, NHS_BASELINE_HEALTHCARE_SHARE } from "./nhsQuality";

/** In-memory federalBudget + ukNhsState fake. */
function fakeDb(opts: { federalBudget?: unknown; nhsQuality?: number } = {}) {
  const nhs: { quality?: number; lastHealthcareShare?: number } =
    opts.nhsQuality !== undefined ? { quality: opts.nhsQuality } : {};
  const collection = vi.fn((name: string) => {
    if (name === "federalBudget") {
      return {
        async findOne() {
          return opts.federalBudget ?? null;
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
  it("rises when enacted fiscal policy funds healthcare above baseline", async () => {
    const { db, nhs } = fakeDb({
      nhsQuality: 60,
      federalBudget: { _id: "UK", spending: { byCategory: { health: 40 }, total: 100 } },
    });
    const q = await tickNhsFromBudget(db, { fiscalYear: 1953, now: new Date() });
    expect(q).toBeGreaterThan(60); // 40% >> 18% baseline → target high → quality climbs
    expect(nhs.quality).toBe(q);
    expect(nhs.lastHealthcareShare).toBe(40);
  });

  it("falls when enacted fiscal policy underfunds healthcare", async () => {
    const { db } = fakeDb({
      nhsQuality: 60,
      federalBudget: { _id: "UK", spending: { byCategory: { health: 4 }, total: 100 } },
    });
    const q = await tickNhsFromBudget(db, { fiscalYear: 1953, now: new Date() });
    expect(q).toBeLessThan(60);
  });

  it("uses the neutral baseline when the fiscal ledger is unavailable", async () => {
    const { db, nhs } = fakeDb({ nhsQuality: 60 }); // no budget
    await tickNhsFromBudget(db, { fiscalYear: 1953, now: new Date() });
    expect(nhs.lastHealthcareShare).toBe(NHS_BASELINE_HEALTHCARE_SHARE);
  });
});
