import { describe, expect, it } from "vitest";
import {
  LEGISLATION_ERA,
  WINDOW_CONSTRAINT_WAIVERS,
  GATED_REVENUE_ACK,
} from "./legislationCatalog";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";
import { METRIC_ERA_WINDOWS } from "./metricCatalog";
import type { CountryId } from "@/lib/constants/countries";

const byId = new Map(legislationTypes.map((t) => [t._id, t]));

/**
 * Authoring validation (house calibration-test pattern): the catalog's data
 * table carries structural invariants the spec demands. Everything here is
 * derived from code/data — never a prose list.
 */
describe("legislation era catalog — authoring validation", () => {
  it("LEGISLATION_ERA keys exactly equal the live seed catalog (full coverage, no orphans)", () => {
    const seedIds = legislationTypes.map((t) => t._id).sort();
    const catalogIds = Object.keys(LEGISLATION_ERA).sort();
    expect(catalogIds).toEqual(seedIds);
  });

  it("every entry is a positive year number or the literal 'always'", () => {
    for (const [id, v] of Object.entries(LEGISLATION_ERA)) {
      const ok = v === "always" || (typeof v === "number" && v > 1900 && v < 2100);
      expect(ok, `${id} = ${String(v)}`).toBe(true);
    }
  });

  it("every waiver / ack id maps to a real seed type", () => {
    for (const id of WINDOW_CONSTRAINT_WAIVERS) expect(byId.has(id), id).toBe(true);
    for (const id of GATED_REVENUE_ACK) expect(byId.has(id), id).toBe(true);
  });

  it("rule #2 — a windowed type's from ≥ its primary metric's window from, unless waived", () => {
    for (const [typeId, from] of Object.entries(LEGISLATION_ERA)) {
      if (from === "always") continue; // era-universal: rule #2 does not apply
      if (WINDOW_CONSTRAINT_WAIVERS.has(typeId)) continue;
      const lt = byId.get(typeId);
      // Primary = first weight-1.0 target, else first target, else vacuous.
      const targets = lt?.effectTargetsWeighted ?? [];
      const primary = targets.find((t) => t.weight === 1.0) ?? targets[0];
      if (!primary) continue;
      const cid = (
        (lt as { countryScope?: string })?.countryScope ?? "us"
      ).toUpperCase() as CountryId;
      const mw = METRIC_ERA_WINDOWS[primary.metricId];
      if (!mw) continue;
      // Resolve the metric window for this type's country (override / scoped / base).
      if (mw.countries && !mw.countries.includes(cid)) continue; // metric not gated here
      const metricFrom = mw.countryOverrides?.[cid]?.from ?? mw.from;
      expect(
        from,
        `${typeId} (from ${from}) vs ${primary.metricId} (${metricFrom})`
      ).toBeGreaterThanOrEqual(metricFrom);
    }
  });

  it("every GATED_REVENUE_ACK type is actually windowed and carries a tax rate option", () => {
    for (const id of GATED_REVENUE_ACK) {
      expect(LEGISLATION_ERA[id], `${id} must be windowed`).toBeTypeOf("number");
      const lt = byId.get(id);
      const hasRate = (lt?.policyOptions ?? []).some(
        (o) => (o as { rate?: number }).rate !== undefined
      );
      expect(hasRate, `${id} must have a tax rate option`).toBe(true);
    }
  });
});
