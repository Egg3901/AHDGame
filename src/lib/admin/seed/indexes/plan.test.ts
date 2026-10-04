import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import {
  collectSeedIndexPlan,
  findMissingSeedIndexes,
  isAutoReconciledSeedIndex,
  isTextIndex,
  isTtlIndex,
  LIVE_WORLD_MANUAL_SEED_INDEXES,
  seedIndexLabel,
} from "./plan";

describe("collectSeedIndexPlan (#2699)", () => {
  it("captures the seed indexes without a database", async () => {
    const plan = await collectSeedIndexPlan();
    expect(plan.length).toBeGreaterThan(300);
    const names = new Set(plan.map((entry) => entry.options.name));
    expect(names.has("macroTelemetry_world_country_region_metric_turn_unique")).toBe(true);
    expect(names.has("financialTxLog_counterpartyId_id")).toBe(true);
    expect(
      plan.filter(
        (entry) => entry.options.name === "corporateSectors_corporation_state_type_models_unique"
      )
    ).toHaveLength(1);
    expect(plan.some(isTextIndex)).toBe(true);
    expect(plan.some(isTtlIndex)).toBe(true);
    expect(
      plan.find(
        (entry) => entry.options.name === "corporateSectors_corporation_state_type_models_unique"
      )
    ).toMatchObject({
      collection: "corporateSectors",
      key: {
        corporationId: 1,
        stateId: 1,
        sectorType: 1,
        industryModel: 1,
        mediaDiscriminator: 1,
      },
      options: { unique: true },
    });
  });

  it("reports only indexes whose key is absent on the live collection", async () => {
    const plan = [
      { collection: "a", key: { x: 1 }, options: { name: "a_x" } },
      { collection: "a", key: { y: 1 }, options: { name: "a_y" } },
      { collection: "b", key: { z: 1 }, options: { name: "b_z" } },
    ];
    const db = {
      collection: (name: string) => ({
        indexes: async () =>
          name === "a" ? [{ key: { _id: 1 } }, { key: { x: 1 }, name: "renamed" }] : [],
      }),
    } as unknown as Db;
    const missing = await findMissingSeedIndexes(db, plan);
    expect(missing.map((entry) => entry.options.name)).toEqual(["a_y", "b_z"]);
  });
});

describe("seed index live-world path guard (#2699)", () => {
  it("names every seed index uniquely, so drift reports and reconciliation can address it", async () => {
    const plan = await collectSeedIndexPlan();
    const unnamed = plan.filter((entry) => !entry.options.name).map(seedIndexLabel);
    expect(unnamed).toEqual([]);
    const labels = plan.map(seedIndexLabel);
    const repeated = labels.filter((label, i) => labels.indexOf(label) !== i);
    // A seed module may re-assert an identical index; a name reused for a
    // different key would make the drift report ambiguous.
    for (const label of new Set(repeated)) {
      const keys = new Set(
        plan
          .filter((entry) => seedIndexLabel(entry) === label)
          .map((entry) => JSON.stringify(entry.key))
      );
      expect({ label, keys: keys.size }).toEqual({ label, keys: 1 });
    }
  });

  it("gives every seed index a live-world path: reconcile migration or a reviewed manual entry", async () => {
    const plan = await collectSeedIndexPlan();
    const manual = new Set(
      plan.filter((entry) => !isAutoReconciledSeedIndex(entry)).map(seedIndexLabel)
    );
    // A new text or TTL seed index must be reviewed and listed; a listed index
    // that no seed module creates any more must be removed from the list.
    expect([...manual].sort()).toEqual(Object.keys(LIVE_WORLD_MANUAL_SEED_INDEXES).sort());
  });
});
