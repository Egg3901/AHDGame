import { describe, expect, it } from "vitest";
import { CN_CABINET_MECHANICS } from "./cnCabinetMechanics";
import { CN_MINISTERIAL_ORDERS } from "./cnCabinetOrders";
import { resolveMetricPath } from "@/lib/cabinet/resolveMetricPath";

/**
 * National central-bank / monetary aggregates the PBoC seat acts on. They are
 * routed into the inflation model (centralBanks.policyInflationPressure) by
 * processMinisterialOrders, NOT into per-region StateMetrics, so they
 * intentionally do not resolve to a nested StateMetrics path. `interestRate` is
 * display-only. Excluding them keeps this guard focused on phantom/typo metrics.
 */
const NATIONAL_ECONOMY_METRICS = new Set(["inflationPressure", "interestRate"]);

/** Collect every metric key referenced by any CN tier/regionalTarget/emergency effect. */
function mechanicsEffectKeys(): string[] {
  const keys: string[] = [];
  for (const mech of Object.values(CN_CABINET_MECHANICS)) {
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

/** Collect every metric key referenced by any CN ministerial order effect. */
function orderEffectKeys(): string[] {
  const keys: string[] = [];
  for (const orders of Object.values(CN_MINISTERIAL_ORDERS)) {
    for (const order of orders) {
      keys.push(...order.effects.map((e) => e.metric));
    }
  }
  return keys;
}

describe("CN cabinet effect metric keys", () => {
  it("every tier/regionalTarget/emergency effect key resolves to a nested path", () => {
    for (const key of mechanicsEffectKeys()) {
      if (NATIONAL_ECONOMY_METRICS.has(key)) continue;
      const resolved = resolveMetricPath(key);
      expect(resolved, `effect key "${key}" did not resolve`).toContain(".");
    }
  });

  it("every ministerial order effect key resolves to a nested path", () => {
    for (const key of orderEffectKeys()) {
      if (NATIONAL_ECONOMY_METRICS.has(key)) continue;
      const resolved = resolveMetricPath(key);
      expect(resolved, `order effect key "${key}" did not resolve`).toContain(".");
    }
  });
});
