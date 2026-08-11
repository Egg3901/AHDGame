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

describe("seedATStateMetrics — 1953 metric-preset overlay", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  // The POLITICAL half of an overlay (lifeExpectancy, literacyRate) no longer
  // reaches a seeded doc at all: the splitter emits macroMetrics only, and the
  // authored era value reaches the game through the BOARD. Each of these
  // overlays is still pinned per era by the adjacent `Baselines` describe,
  // which reads the legacy-shaped stateBaselines the decay loop uses.
  it("overlays AT-1953 authored values onto Vienna (urbanization 94)", async () => {
    const { seedATStateMetrics } = await import("@/lib/admin/seed/seedAT");
    await seedATStateMetrics(db as unknown as Db, true, () => {}, "1953-default");
    expect(regionMacroSet(db, "AT_VIE").population.urbanizationRate.value).toBe(94);
    expect(db.collectionMocks.stateMetrics?.updateOne.mock.calls ?? []).toHaveLength(0);
  });

  it("leaves 2019-default AT on the base ~1979 bundle (lifeExpectancy 72)", async () => {
    // Re-pointed at the baselines: this asserts the 1953 overlay is NOT applied
    // for a 2019 world, which is the property that matters, and lifeExpectancy
    // is the metric that distinguishes the two bundles.
    const { seedATBaselines } = await import("@/lib/admin/seed/seedAT");
    await seedATBaselines(db as unknown as Db, true, () => {}, "2019-default");
    expect(regionBaselineSet(db, "AT_VIE").baselines.healthcare.lifeExpectancy).toBe(72);
  });
});

describe("seedATBaselines — 1953 metric-preset overlay (decay targets)", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("aligns 1953 Vienna decay targets with the authored metric values", async () => {
    const { seedATBaselines } = await import("@/lib/admin/seed/seedAT");
    await seedATBaselines(db as unknown as Db, true, () => {}, "1953-default");
    const { baselines } = regionBaselineSet(db, "AT_VIE");
    expect(baselines.healthcare.lifeExpectancy).toBe(68);
    expect(baselines.population.urbanizationRate).toBe(94);
  });
});

describe("seedFIStateMetrics — 1953 metric-preset overlay", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("overlays FI-1953 authored values onto Uusimaa (urbanization 72)", async () => {
    const { seedFIStateMetrics } = await import("@/lib/admin/seed/seedFI");
    await seedFIStateMetrics(db as unknown as Db, true, () => {}, "1953-default");
    expect(regionMacroSet(db, "FI_UUS").population.urbanizationRate.value).toBe(72);
    expect(db.collectionMocks.stateMetrics?.updateOne.mock.calls ?? []).toHaveLength(0);
  });
});

describe("seedFIBaselines — 1953 metric-preset overlay (decay targets)", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("aligns 1953 Uusimaa decay targets with the authored metric values", async () => {
    const { seedFIBaselines } = await import("@/lib/admin/seed/seedFI");
    await seedFIBaselines(db as unknown as Db, true, () => {}, "1953-default");
    const { baselines } = regionBaselineSet(db, "FI_UUS");
    expect(baselines.healthcare.lifeExpectancy).toBe(68);
    expect(baselines.population.urbanizationRate).toBe(72);
  });
});

describe("seedGRStateMetrics — 1953 metric-preset overlay", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("writes no legacy political doc for GR-1953 — the overlay lands on the board", async () => {
    // GR's authored 1953 overlay is entirely political (lifeExpectancy 66,
    // literacyRate 85), so after the retirement there is nothing for the seeder
    // to write. Both values stay pinned by the Baselines describe below.
    const { seedGRStateMetrics } = await import("@/lib/admin/seed/seedGR");
    await seedGRStateMetrics(db as unknown as Db, true, () => {}, "1953-default");
    expect(db.collectionMocks.stateMetrics?.updateOne.mock.calls ?? []).toHaveLength(0);
  });
});

describe("seedGRBaselines — 1953 metric-preset overlay (decay targets)", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("aligns 1953 Attica decay targets with the authored metric values", async () => {
    const { seedGRBaselines } = await import("@/lib/admin/seed/seedGR");
    await seedGRBaselines(db as unknown as Db, true, () => {}, "1953-default");
    const { baselines } = regionBaselineSet(db, "GR_ATT");
    expect(baselines.healthcare.lifeExpectancy).toBe(66);
    expect(baselines.education.literacyRate).toBe(85);
  });
});
