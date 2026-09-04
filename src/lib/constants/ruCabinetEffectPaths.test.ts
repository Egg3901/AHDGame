import { describe, expect, it } from "vitest";
import { RU_CABINET_MECHANICS } from "./ruCabinetMechanics";
import { RU_CABINET_POSITIONS } from "./ruCabinet";
import { DD_CABINET_POSITIONS } from "./ddCabinet";
import { RU_MINISTERIAL_ORDERS } from "./ruCabinetOrders";
import { DD_MINISTERIAL_ORDERS } from "./ddCabinetOrders";
import { getMinisterialOrders } from "./cabinetOrders";
import { resolveMetricPath } from "@/lib/cabinet/resolveMetricPath";
import { metricCategories } from "@/lib/constants/metricDefinitions";

/**
 * National central-bank / monetary aggregates the Gosbank seat acts on. They
 * are routed into the inflation model by processMinisterialOrders, NOT into
 * per-region StateMetrics (the CN PBoC precedent), so they intentionally do
 * not resolve to a nested StateMetrics path.
 */
const NATIONAL_ECONOMY_METRICS = new Set(["inflationPressure", "interestRate"]);

/** Collect every metric key referenced by any RU tier/regionalTarget/emergency effect. */
function mechanicsEffectKeys(): string[] {
  const keys: string[] = [];
  for (const mech of Object.values(RU_CABINET_MECHANICS)) {
    for (const tier of mech.tierSetting?.options ?? []) {
      keys.push(...Object.keys(tier.effects));
    }
    if (mech.regionalTarget) {
      keys.push(...Object.keys(mech.regionalTarget.effects));
      keys.push(...Object.keys(mech.regionalTarget.nonTargetEffects ?? {}));
    }
    if (mech.emergency) {
      keys.push(...Object.keys(mech.emergency.effects));
      keys.push(...Object.keys(mech.emergency.sideEffects ?? {}));
    }
  }
  return keys;
}

describe("RU cabinet effect metric keys", () => {
  it("every tier/regionalTarget/emergency effect key resolves to a nested path", () => {
    for (const key of mechanicsEffectKeys()) {
      if (NATIONAL_ECONOMY_METRICS.has(key)) continue;
      const resolved = resolveMetricPath(key);
      expect(resolved, `effect key "${key}" did not resolve`).toContain(".");
    }
  });

  it("every cabinet position has a mechanics entry", () => {
    for (const pos of RU_CABINET_POSITIONS) {
      expect(RU_CABINET_MECHANICS[pos.id], pos.id).toBeDefined();
      expect(RU_CABINET_MECHANICS[pos.id].positionId).toBe(pos.id);
    }
  });

  it("D7: Foreign and Internal Trade tiers are mechanically distinct", () => {
    const foreign = RU_CABINET_MECHANICS.minister_of_foreign_trade.tierSetting;
    const internal = RU_CABINET_MECHANICS.minister_of_internal_trade.tierSetting;
    expect(foreign).toBeDefined();
    expect(internal).toBeDefined();
    const effectsOf = (t: NonNullable<typeof foreign>) => t.options.map((o) => o.effects);
    expect(effectsOf(foreign!)).not.toEqual(effectsOf(internal!));
    // Distinct orientation: foreign trade moves growth in its active tiers;
    // internal trade moves household costs + employment.
    const foreignKeys = new Set(effectsOf(foreign!).flatMap((e) => Object.keys(e)));
    const internalKeys = new Set(effectsOf(internal!).flatMap((e) => Object.keys(e)));
    expect(foreignKeys.has("gdpGrowth")).toBe(true);
    expect(internalKeys.has("unemploymentRate")).toBe(true);
    expect(internalKeys.has("gdpGrowth")).toBe(false);
  });
});

describe("RU/DD ministerial orders", () => {
  it("every RU seat has exactly two orders", () => {
    for (const pos of RU_CABINET_POSITIONS) {
      const orders = RU_MINISTERIAL_ORDERS[pos.id];
      expect(orders, pos.id).toBeDefined();
      expect(orders.length, pos.id).toBe(2);
    }
  });

  it("every DD seat has exactly two orders", () => {
    for (const pos of DD_CABINET_POSITIONS) {
      const orders = DD_MINISTERIAL_ORDERS[pos.id];
      expect(orders, pos.id).toBeDefined();
      expect(orders.length, pos.id).toBe(2);
    }
  });

  it("every order effect metric resolves to a nested path", () => {
    for (const orders of Object.values(RU_MINISTERIAL_ORDERS)) {
      for (const order of orders) {
        for (const effect of order.effects) {
          if (NATIONAL_ECONOMY_METRICS.has(effect.metric)) continue;
          expect(resolveMetricPath(effect.metric), `${order.id} → ${effect.metric}`).toContain(".");
        }
      }
    }
  });

  it("order ids are unique across the RU cabinet", () => {
    const ids = Object.values(RU_MINISTERIAL_ORDERS).flatMap((o) => o.map((x) => x.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("the orders barrel serves RU and DD", () => {
    expect(getMinisterialOrders("RU", "chairman_of_gosplan").length).toBe(2);
    expect(getMinisterialOrders("DD", "generalSecretary").length).toBe(2);
    // RU's `premier` key must NOT leak into DD, whose head-of-government seat
    // is `generalSecretary`.
    expect(getMinisterialOrders("DD", "premier").length).toBe(0);
  });
});

describe("RU cabinet metric categories", () => {
  it("every national and regional metric names a real category and metric", () => {
    const valid = new Set(metricCategories.flatMap((c) => c.metrics.map((m) => `${c.id}.${m.id}`)));
    // Central-bank/budget-sourced metrics live outside StateMetrics.
    const exempt = new Set(["economic.inflationPressure", "economic.interestRate"]);
    for (const mech of Object.values(RU_CABINET_MECHANICS)) {
      for (const metric of [...mech.nationalMetrics, ...mech.regionalMetrics]) {
        const path = `${metric.category}.${metric.metricId}`;
        if (exempt.has(path)) continue;
        expect(valid.has(path), `${mech.positionId} → ${path}`).toBe(true);
      }
    }
  });
});

describe("RU cabinet mechanics coverage", () => {
  /** Leadership/coordination and nationally-scoped seats have no regional lever. */
  const NO_REGIONAL_TARGET = new Set([
    "premier",
    "first_deputy_premier",
    "minister_of_foreign_affairs",
    "gosbank_liaison",
    // The security service is a national instrument: it runs networks abroad and
    // counter-intelligence at home, neither of which sites in one republic.
    "director_of_intelligence",
  ]);
  /** Foreign Trade's lever is its trade-posture tier, not a crisis deployment. */
  const NO_EMERGENCY = new Set([...NO_REGIONAL_TARGET, "minister_of_foreign_trade"]);

  it("every seat has a tier setting", () => {
    for (const pos of RU_CABINET_POSITIONS) {
      expect(RU_CABINET_MECHANICS[pos.id].tierSetting, pos.id).toBeDefined();
    }
  });

  it("regional and national seats carry the right levers", () => {
    for (const pos of RU_CABINET_POSITIONS) {
      const mech = RU_CABINET_MECHANICS[pos.id];
      if (NO_REGIONAL_TARGET.has(pos.id)) {
        expect(mech.regionalTarget, pos.id).toBeUndefined();
      } else {
        expect(mech.regionalTarget, pos.id).toBeDefined();
      }
      if (NO_EMERGENCY.has(pos.id)) {
        expect(mech.emergency, pos.id).toBeUndefined();
      } else {
        expect(mech.emergency, pos.id).toBeDefined();
        expect(mech.emergency!.cost, pos.id).toBe(1);
      }
    }
  });

  it("every tier setting's defaultTier is one of its options", () => {
    for (const mech of Object.values(RU_CABINET_MECHANICS)) {
      const tier = mech.tierSetting;
      if (!tier) continue;
      const ids = tier.options.map((o) => o.id);
      expect(ids, mech.positionId).toContain(tier.defaultTier);
      expect(tier.options.length, mech.positionId).toBeGreaterThanOrEqual(3);
    }
  });
});
