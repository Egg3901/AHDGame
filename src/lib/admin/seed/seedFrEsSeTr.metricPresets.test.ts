import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb, bulkOps } from "@/lib/test-utils/mockDb";

type MetricSet = Record<string, Record<string, { value: number }>>;
type BaselineSet = { baselines: Record<string, Record<string, number>> };

function regionBaselineSet(db: MockDb, id: string): BaselineSet {
  const calls = db.collectionMocks.stateBaselines!.updateOne.mock.calls;
  const row = calls.find((c) => (c[0] as { _id: string })._id === id);
  return (row![1] as { $set: BaselineSet }).$set;
}

function regionMacroSet(db: MockDb, id: string): MetricSet {
  const calls = bulkOps(db.collectionMocks.macroMetrics!.bulkWrite);
  const row = calls.find((c) => (c[0] as { _id: string })._id === id);
  return (row![1] as { $set: MetricSet }).$set;
}

describe("seedFRStateMetrics — 1953 metric-preset overlay", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  // The POLITICAL half of an overlay (lifeExpectancy, literacyRate) no longer
  // reaches a seeded doc: the splitter emits macroMetrics only, and the authored
  // era value reaches the game through the BOARD. Each overlay stays pinned per
  // era by the adjacent `Baselines` describe, which reads the legacy-shaped
  // stateBaselines the decay loop still uses.
  it("overlays FR-1953 authored values onto Île-de-France (urbanization 88)", async () => {
    const { seedFRStateMetrics } = await import("@/lib/admin/seed/seedFR");
    await seedFRStateMetrics(db as unknown as Db, true, () => {}, "1953-default");
    expect(regionMacroSet(db, "FR_IDF").population.urbanizationRate.value).toBe(88);
    expect(db.collectionMocks.stateMetrics?.updateOne.mock.calls ?? []).toHaveLength(0);
  });

  it("leaves 2019-default FR on the base ~1979 bundle (lifeExpectancy 73.5)", async () => {
    // No 2019 FR overlay registered → getRegionMetricPresets returns null → base
    // seed. Asserted through the baselines, which still carry political paths.
    const { seedFRBaselines } = await import("@/lib/admin/seed/seedFR");
    await seedFRBaselines(db as unknown as Db, true, () => {}, "2019-default");
    expect(regionBaselineSet(db, "FR_IDF").baselines.healthcare.lifeExpectancy).toBe(73.5);
  });
});

describe("seedFRBaselines — 1953 metric-preset overlay (decay targets)", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("aligns 1953 Île-de-France decay targets with the authored metric values", async () => {
    const { seedFRBaselines } = await import("@/lib/admin/seed/seedFR");
    await seedFRBaselines(db as unknown as Db, true, () => {}, "1953-default");
    const { baselines } = regionBaselineSet(db, "FR_IDF");
    expect(baselines.healthcare.lifeExpectancy).toBe(68);
    expect(baselines.population.urbanizationRate).toBe(88);
  });
});

describe("seedESStateMetrics — 1953 metric-preset overlay", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("writes no legacy political doc for ES-1953 — the overlay lands on the board", async () => {
    // ES's authored 1953 overlay is entirely political (lifeExpectancy 59,
    // literacyRate 78); both stay pinned by the Baselines describe below.
    const { seedESStateMetrics } = await import("@/lib/admin/seed/seedES");
    await seedESStateMetrics(db as unknown as Db, true, () => {}, "1953-default");
    expect(db.collectionMocks.stateMetrics?.updateOne.mock.calls ?? []).toHaveLength(0);
  });
});

describe("seedESBaselines — 1953 metric-preset overlay (decay targets)", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("aligns 1953 Andalusia decay targets with the authored metric values", async () => {
    const { seedESBaselines } = await import("@/lib/admin/seed/seedES");
    await seedESBaselines(db as unknown as Db, true, () => {}, "1953-default");
    const { baselines } = regionBaselineSet(db, "ES_AND");
    expect(baselines.healthcare.lifeExpectancy).toBe(59);
    expect(baselines.education.literacyRate).toBe(78);
  });
});

describe("seedSEStateMetrics — 1953 metric-preset overlay", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("overlays SE-1953 authored values onto Stockholm (medianIncome 9900, urbanization 90)", async () => {
    const { seedSEStateMetrics } = await import("@/lib/admin/seed/seedSE");
    await seedSEStateMetrics(db as unknown as Db, true, () => {}, "1953-default");
    const macro = regionMacroSet(db, "SE_STH");
    expect(macro.economic.medianIncome.value).toBe(9_900);
    expect(macro.population.urbanizationRate.value).toBe(90);
  });
});

describe("seedSEBaselines — 1953 metric-preset overlay (decay targets)", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("aligns 1953 Stockholm decay targets with the authored metric values", async () => {
    const { seedSEBaselines } = await import("@/lib/admin/seed/seedSE");
    await seedSEBaselines(db as unknown as Db, true, () => {}, "1953-default");
    const { baselines } = regionBaselineSet(db, "SE_STH");
    expect(baselines.economic.medianIncome).toBe(9_900);
    expect(baselines.population.urbanizationRate).toBe(90);
  });
});

describe("seedTRStateMetrics — 1953 metric-preset overlay", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("writes no legacy political doc for TR-1953 — the overlay lands on the board", async () => {
    // TR's authored 1953 overlay is entirely political (lifeExpectancy 48,
    // literacyRate 55); both stay pinned by the Baselines describe below.
    const { seedTRStateMetrics } = await import("@/lib/admin/seed/seedTR");
    await seedTRStateMetrics(db as unknown as Db, true, () => {}, "1953-default");
    expect(db.collectionMocks.stateMetrics?.updateOne.mock.calls ?? []).toHaveLength(0);
  });
});

describe("seedTRBaselines — 1953 metric-preset overlay (decay targets)", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("aligns 1953 Istanbul decay targets with the authored metric values", async () => {
    const { seedTRBaselines } = await import("@/lib/admin/seed/seedTR");
    await seedTRBaselines(db as unknown as Db, true, () => {}, "1953-default");
    const { baselines } = regionBaselineSet(db, "TR_IST");
    expect(baselines.healthcare.lifeExpectancy).toBe(48);
    expect(baselines.education.literacyRate).toBe(55);
  });
});
