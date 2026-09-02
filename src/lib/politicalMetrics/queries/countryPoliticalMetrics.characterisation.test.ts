import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { NATIONAL_BASELINES_1953 } from "../seeds/nationalBaselines1953";
import { POLITICAL_METRIC_FAMILIES } from "../families";
import type { PoliticalMetricId } from "../types";
import { loadCountryPoliticalMetrics } from "./countryPoliticalMetrics";

/**
 * Characterisation guard for the national payload.
 *
 * The modifiers decomposition, the relevant-legislation join and the evidence
 * resolution are being lifted out of this loader so a region-scope loader can
 * share the exact same arithmetic. That refactor must not change a single key
 * the dashboard reads, and this file is the seatbelt that proves it.
 *
 * These are deliberately shape assertions, not value assertions: the sibling
 * `countryPoliticalMetrics.test.ts` already pins the numbers.
 */

/** Region values = US national baselines, with an optional per-metric override. */
function regionValues(overrides: Partial<Record<PoliticalMetricId, number>> = {}) {
  const values = {} as Record<PoliticalMetricId, number>;
  for (const f of POLITICAL_METRIC_FAMILIES) {
    values[f.id] = overrides[f.id] ?? NATIONAL_BASELINES_1953.US[f.id].value;
  }
  return values;
}

const DOCS = [
  { _id: "MI", countryId: "US", values: regionValues({ "economy.workerSecurity": 69 }) },
  { _id: "AL", countryId: "US", values: regionValues({ "economy.workerSecurity": 55 }) },
];
const STATES = [
  { _id: "MI", name: "Michigan", population: 6_500_000 },
  { _id: "AL", name: "Alabama", population: 3_000_000 },
];

const TOP_LEVEL_KEYS = [
  "categories",
  "countryDisplayName",
  "countryId",
  "governanceStyle",
  "overall",
  "overallStatus",
  "turn",
  "year",
];

const METRIC_KEYS = [
  "id",
  "lean",
  "leanLabel",
  "displayName",
  "description",
  "pos",
  "neg",
  "indicators",
  // `value` is the scope-neutral field the shared cards read; `nationalValue`
  // stays alongside it so nothing that already reads the national payload breaks.
  "value",
  "nationalValue",
  "status",
  "legislation",
  "history",
  "modifiers",
  "evidence",
  "regions",
];

const MODIFIER_KEYS = [
  "laws",
  "residual",
  "cabinet",
  "cabinetBySource",
  "cabinetAtCap",
  "cabinetCap",
  "driftHalfLifeTurns",
  "target",
  "direction",
];

describe("loadCountryPoliticalMetrics — payload shape is frozen", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collection("politicalMetrics").find().toArray.mockResolvedValue(DOCS);
    db.collection("states").find().toArray.mockResolvedValue(STATES);
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 212,
      currentYear: 1953,
      preset: "1953-default",
    });
  });

  it("emits the documented top-level keys", async () => {
    const res = await loadCountryPoliticalMetrics("US", db as unknown as Db);
    expect(res).not.toBeNull();
    expect(Object.keys(res!).sort()).toEqual([...TOP_LEVEL_KEYS].sort());
  });

  it("emits the documented per-category keys", async () => {
    const res = await loadCountryPoliticalMetrics("US", db as unknown as Db);
    expect(Object.keys(res!.categories[0]).sort()).toEqual(
      ["id", "displayName", "score", "status", "metrics"].sort()
    );
  });

  it("emits every documented per-metric key", async () => {
    const res = await loadCountryPoliticalMetrics("US", db as unknown as Db);
    const metric = res!.categories[0].metrics[0];
    for (const key of METRIC_KEYS) {
      expect(metric, `missing ${key}`).toHaveProperty(key);
    }
  });

  it("keeps the modifiers decomposition keys", async () => {
    const res = await loadCountryPoliticalMetrics("US", db as unknown as Db);
    const mods = res!.categories[0].metrics[0].modifiers;
    for (const key of MODIFIER_KEYS) {
      expect(mods, `missing ${key}`).toHaveProperty(key);
    }
  });

  it("keeps the per-region breakdown rows addressable by region id", async () => {
    const res = await loadCountryPoliticalMetrics("US", db as unknown as Db);
    const region = res!.categories[0].metrics[0].regions[0];
    expect(Object.keys(region).sort()).toEqual(["name", "regionId", "value"].sort());
  });
});
