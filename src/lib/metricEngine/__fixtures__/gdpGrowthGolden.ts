import { vi } from "vitest";
import type { Db } from "mongodb";
import type { MockDb } from "@/lib/test-utils/mockDb";

/**
 * Golden-master scenarios for the gdpGrowth → metricEngine port (spec P0 R2).
 *
 * **P1c-2 supersession:** the P0 contract was `gdpGrowth = the sector EMA`. P1c-2
 * split that into `economic.sectorGrowth` (the EMA'd cyclical SIGNAL — the value
 * the P0 fixtures froze) and the INTEGRATED `economic.gdpGrowth = potential +
 * output-gap`. So the parity gate now lives on `sectorGrowth` (same frozen values
 * — the sector EMA + policy-delta + FX + fallback behavior is unchanged), and we
 * additionally assert the integrated `gdpGrowth` equals the sector signal at
 * cold-start (output gap 0) — the cutover-safety property (gdpGrowth must not jump
 * on deploy). Unemployment now keys Okun off `gdpGrowth − potential` (P1c-2) — it
 * is no longer a fixed-reference parity invariant, so it moved out of the golden
 * gate into the `unemploymentNode` / phase unit tests.
 *
 * Named guards (R2): the policy-delta cap (MAX_POLICY_DELTA=4), NaN-prev
 * rejection, FX revenue normalization, and the legacy `growthRate` fallback are
 * each their own scenario so the port can't silently regress them.
 */

export interface GoldenStateOut {
  _id: string;
  /** The cyclical sector signal (parity-preserved; the old gdpGrowth value). */
  gdpGrowth: number;
  /** The sector EMA baseline (parity-preserved). */
  sectorBaseline: number;
  /** Integrated gdpGrowth = potential + gap; equals the sector signal at gap 0. */
  integratedGdp: number;
}

export interface GoldenScenario {
  name: string;
  turn: number;
  /** Seed the MockDb collections this scenario needs. */
  seed: (db: MockDb) => void;
  /** Frozen expected per-state output (filled by the capture run). */
  expected: GoldenStateOut[];
}

/** Stub a collection's find() to return `data` (projection-compatible cursor). */
function setupCollection<T>(db: MockDb, name: string, data: T[]): void {
  db.collection(name);
  db.collectionMocks[name]!.find = vi.fn().mockReturnValue({
    project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(data) }),
    toArray: vi.fn().mockResolvedValue(data),
  });
}

/**
 * P2/D7: stub the gameConfig read the sector provider does for the market mode.
 * Scenarios that omit it get MockDb's default `findOne → null` = mode "off",
 * which is why every pre-plants fixture keeps its frozen value untouched.
 */
function setupGameConfig(db: MockDb, marketSystemMode: string): void {
  db.collection("gameConfig");
  const existing = db.collectionMocks.gameConfig!.findOne;
  db.collectionMocks.gameConfig!.findOne = vi
    .fn()
    .mockImplementation(async (...args: unknown[]) => ({
      ...((await existing(...args)) ?? {}),
      _id: "default",
      marketSystemMode,
    }));
}

function state(_id: string, countryId = "US") {
  return { _id, name: _id, countryId, population: 100_000, gdp: 1_000_000 };
}

/**
 * Capture the per-state bulkWrite output of a phase fn (updateGdpGrowth or
 * runMetricEngine) for a seeded scenario. Resets the shared FX cache first so
 * FX scenarios are deterministic and don't leak across scenarios.
 */
export async function captureGoldenOutput(
  db: MockDb,
  phaseFn: (db: Db, turn: number) => Promise<number>,
  turn: number
): Promise<GoldenStateOut[]> {
  // The engine writes ECONOMIC paths, which live on macroMetrics since SP5.
  // Capturing from macroMetrics rather than stateMetrics keeps this golden
  // valid once stateMetrics is deleted.
  db.collection("macroMetrics");
  const captured: GoldenStateOut[] = [];
  db.collectionMocks.macroMetrics!.bulkWrite = vi.fn().mockImplementation((ops: unknown[]) => {
    for (const op of ops as Array<{
      updateOne: { filter: { _id: string }; update: { $set: Record<string, number> } };
    }>) {
      const set = op.updateOne.update.$set;
      captured.push({
        _id: op.updateOne.filter._id,
        // Parity lives on the sector SIGNAL now (P1c-2 split); fall back to the
        // legacy gdpGrowth fields when a pre-split fn (old updateGdpGrowth) is run.
        gdpGrowth: set["economic.sectorGrowth.value"] ?? set["economic.gdpGrowth.value"],
        sectorBaseline:
          set["economic.sectorGrowth.simBaseline"] ??
          set["economic.gdpGrowth.simBaseline"] ??
          set["economic.gdpGrowth.sectorBaseline"],
        integratedGdp: set["economic.gdpGrowth.value"],
      });
    }
    return Promise.resolve({ ok: 1 });
  });
  await phaseFn(db as unknown as Db, turn);
  return captured.sort((a, b) => a._id.localeCompare(b._id));
}

export const GDP_GROWTH_SCENARIOS: GoldenScenario[] = [
  {
    name: "happy-path (cold-start, neutral tax)",
    turn: 10,
    seed: (db) => {
      setupCollection(db, "states", [state("s1")]);
      setupCollection(db, "corporateSectors", [
        {
          _id: "secA",
          stateId: "s1",
          revenue: 1000,
          currentGrowthRate: 3,
          corporationId: undefined,
        },
      ]);
      setupCollection(db, "unownedSectors", [{ _id: "uA", stateId: "s1", revenue: 500 }]);
      setupCollection(db, "macroMetrics", []); // no prev → cold-start
      db.collectionMocks.stateMetrics = db.collectionMocks.macroMetrics!;
      setupCollection(db, "corporations", []);
      setupCollection(db, "exchangeRates", []);
      // US neutral fed=0, state=6 → taxGap 0
      setupCollection(db, "federalBudget", [
        { _id: "federal", countryId: "US", taxRates: { salesTax: 0 } },
      ]);
      setupCollection(db, "stateBudgets", [{ _id: "s1", taxRates: { salesTax: 6 } }]);
    },
    expected: [{ _id: "s1", gdpGrowth: 2.167, sectorBaseline: 2.167, integratedGdp: 2.167 }],
  },
  {
    name: "policy-delta-cap (MAX_POLICY_DELTA=4)",
    turn: 10,
    seed: (db) => {
      setupCollection(db, "states", [state("s2")]);
      setupCollection(db, "corporateSectors", [
        {
          _id: "secB",
          stateId: "s2",
          revenue: 1000,
          currentGrowthRate: 2,
          corporationId: undefined,
        },
      ]);
      setupCollection(db, "unownedSectors", []);
      // prev value 15 vs baseline 2 → rawPolicyDelta 13, capped to 4 (v0 #2)
      setupCollection(db, "macroMetrics", [
        {
          _id: "s2",
          economic: {
            gdpGrowth: { value: 15, sectorBaseline: 2 },
            unemploymentRate: { value: 5 },
          },
        },
      ]);
      db.collectionMocks.stateMetrics = db.collectionMocks.macroMetrics!;
      setupCollection(db, "corporations", []);
      setupCollection(db, "exchangeRates", []);
      setupCollection(db, "federalBudget", [
        { _id: "federal", countryId: "US", taxRates: { salesTax: 0 } },
      ]);
      setupCollection(db, "stateBudgets", [{ _id: "s2", taxRates: { salesTax: 6 } }]);
    },
    expected: [{ _id: "s2", gdpGrowth: 6, sectorBaseline: 2, integratedGdp: 6 }],
  },
  {
    name: "nan-prev-rejected (NaN prev value → fresh)",
    turn: 10,
    seed: (db) => {
      setupCollection(db, "states", [state("s3")]);
      setupCollection(db, "corporateSectors", [
        {
          _id: "secC",
          stateId: "s3",
          revenue: 1000,
          currentGrowthRate: 4,
          corporationId: undefined,
        },
      ]);
      setupCollection(db, "unownedSectors", []);
      setupCollection(db, "macroMetrics", [
        {
          _id: "s3",
          economic: {
            gdpGrowth: { value: NaN, sectorBaseline: NaN },
            unemploymentRate: { value: NaN },
          },
        },
      ]);
      db.collectionMocks.stateMetrics = db.collectionMocks.macroMetrics!;
      setupCollection(db, "corporations", []);
      setupCollection(db, "exchangeRates", []);
      setupCollection(db, "federalBudget", [
        { _id: "federal", countryId: "US", taxRates: { salesTax: 0 } },
      ]);
      setupCollection(db, "stateBudgets", [{ _id: "s3", taxRates: { salesTax: 6 } }]);
    },
    expected: [{ _id: "s3", gdpGrowth: 4, sectorBaseline: 4, integratedGdp: 4 }],
  },
  {
    name: "fx-normalized (two corps, different currencies)",
    turn: 10,
    seed: (db) => {
      setupCollection(db, "states", [state("s4", "UK")]);
      setupCollection(db, "corporateSectors", [
        {
          _id: "secD1",
          stateId: "s4",
          revenue: 1000,
          currentGrowthRate: 2,
          corporationId: "corpGBP",
        },
        {
          _id: "secD2",
          stateId: "s4",
          revenue: 1000,
          currentGrowthRate: 4,
          corporationId: "corpUSD",
        },
      ]);
      setupCollection(db, "unownedSectors", []);
      setupCollection(db, "macroMetrics", []);
      db.collectionMocks.stateMetrics = db.collectionMocks.macroMetrics!;
      setupCollection(db, "corporations", [
        { _id: "corpGBP", countryId: "UK", liquidCurrencyCode: "GBP" },
        { _id: "corpUSD", countryId: "US", liquidCurrencyCode: "USD" },
      ]);
      // local-per-₳: GBP 0.8 → 1000 GBP = 1250 ₳; USD 1.0 → 1000 USD = 1000 ₳
      setupCollection(db, "exchangeRates", [
        { currencyCode: "GBP", rate: 0.8 },
        { currencyCode: "USD", rate: 1.0 },
      ]);
      // UK neutral fed=20, state=0 → set fed 20 to keep taxGap 0
      setupCollection(db, "federalBudget", [
        { _id: "UK", countryId: "UK", taxRates: { salesTax: 20 } },
      ]);
      setupCollection(db, "stateBudgets", [{ _id: "s4", taxRates: { salesTax: 0 } }]);
    },
    expected: [{ _id: "s4", gdpGrowth: 2.889, sectorBaseline: 2.889, integratedGdp: 2.889 }],
  },
  {
    name: "legacy-growthRate-fallback (no currentGrowthRate)",
    turn: 10,
    seed: (db) => {
      setupCollection(db, "states", [state("s5")]);
      setupCollection(db, "corporateSectors", [
        { _id: "secE", stateId: "s5", revenue: 1000, growthRate: 5, corporationId: undefined },
      ]);
      setupCollection(db, "unownedSectors", []);
      setupCollection(db, "macroMetrics", []);
      db.collectionMocks.stateMetrics = db.collectionMocks.macroMetrics!;
      setupCollection(db, "corporations", []);
      setupCollection(db, "exchangeRates", []);
      setupCollection(db, "federalBudget", [
        { _id: "federal", countryId: "US", taxRates: { salesTax: 0 } },
      ]);
      setupCollection(db, "stateBudgets", [{ _id: "s5", taxRates: { salesTax: 6 } }]);
    },
    expected: [{ _id: "s5", gdpGrowth: 5, sectorBaseline: 5, integratedGdp: 5 }],
  },
  // ── P2/D7: plants mode ──────────────────────────────────────────────────
  // Under `marketSystemMode = "plants"` the owned contribution is the region's
  // ANNUALIZED realized-revenue delta (unowned mass excluded), not the now
  // vestigial `currentGrowthRate`. These scenarios are ADDITIVE — every case
  // above runs with no gameConfig (mode "off") and keeps its frozen value.
  {
    name: "plants: region realized-revenue delta replaces currentGrowthRate",
    turn: 10,
    seed: (db) => {
      // prev Σ realized 1000 @ turn 6 → now 1010 over 4 turns:
      // (1010/1000 − 1) × 100 × (48/4) = 12. currentGrowthRate 3 and the unowned
      // 0.5 pin are both ignored.
      setupCollection(db, "states", [
        { ...state("s6"), sectorRealizedRevenue: 1000, sectorRealizedRevenueTurn: 6 },
      ]);
      setupCollection(db, "corporateSectors", [
        {
          _id: "secF",
          stateId: "s6",
          revenue: 1010,
          currentGrowthRate: 3,
          corporationId: undefined,
        },
      ]);
      setupCollection(db, "unownedSectors", [{ _id: "uF", stateId: "s6", revenue: 500 }]);
      setupCollection(db, "macroMetrics", []); // cold-start → value = raw signal
      db.collectionMocks.stateMetrics = db.collectionMocks.macroMetrics!;
      setupCollection(db, "corporations", []);
      setupCollection(db, "exchangeRates", []);
      setupCollection(db, "federalBudget", [
        { _id: "federal", countryId: "US", taxRates: { salesTax: 0 } },
      ]);
      setupCollection(db, "stateBudgets", [{ _id: "s6", taxRates: { salesTax: 6 } }]);
      setupGameConfig(db, "plants");
    },
    expected: [{ _id: "s6", gdpGrowth: 12, sectorBaseline: 12, integratedGdp: 12 }],
  },
  {
    name: "plants: flip turn with no realized baseline falls back to the legacy signal",
    turn: 10,
    seed: (db) => {
      // No sectorRealizedRevenue on the state doc (first plants turn) → the
      // legacy weighted average, identical to the happy-path scenario (2.167).
      setupCollection(db, "states", [state("s7")]);
      setupCollection(db, "corporateSectors", [
        {
          _id: "secG",
          stateId: "s7",
          revenue: 1000,
          currentGrowthRate: 3,
          corporationId: undefined,
        },
      ]);
      setupCollection(db, "unownedSectors", [{ _id: "uG", stateId: "s7", revenue: 500 }]);
      setupCollection(db, "macroMetrics", []);
      db.collectionMocks.stateMetrics = db.collectionMocks.macroMetrics!;
      setupCollection(db, "corporations", []);
      setupCollection(db, "exchangeRates", []);
      setupCollection(db, "federalBudget", [
        { _id: "federal", countryId: "US", taxRates: { salesTax: 0 } },
      ]);
      setupCollection(db, "stateBudgets", [{ _id: "s7", taxRates: { salesTax: 6 } }]);
      setupGameConfig(db, "plants");
    },
    expected: [{ _id: "s7", gdpGrowth: 2.167, sectorBaseline: 2.167, integratedGdp: 2.167 }],
  },
  {
    name: "plants: a revenue explosion is clamped to the node ceiling before the EMA",
    turn: 10,
    seed: (db) => {
      // 1000 → 2000 in one turn annualizes to +4800% — clamped to 15.
      setupCollection(db, "states", [
        { ...state("s8"), sectorRealizedRevenue: 1000, sectorRealizedRevenueTurn: 9 },
      ]);
      setupCollection(db, "corporateSectors", [
        {
          _id: "secH",
          stateId: "s8",
          revenue: 2000,
          currentGrowthRate: 1,
          corporationId: undefined,
        },
      ]);
      setupCollection(db, "unownedSectors", []);
      setupCollection(db, "macroMetrics", []);
      db.collectionMocks.stateMetrics = db.collectionMocks.macroMetrics!;
      setupCollection(db, "corporations", []);
      setupCollection(db, "exchangeRates", []);
      setupCollection(db, "federalBudget", [
        { _id: "federal", countryId: "US", taxRates: { salesTax: 0 } },
      ]);
      setupCollection(db, "stateBudgets", [{ _id: "s8", taxRates: { salesTax: 6 } }]);
      setupGameConfig(db, "plants");
    },
    expected: [{ _id: "s8", gdpGrowth: 15, sectorBaseline: 15, integratedGdp: 15 }],
  },
];
