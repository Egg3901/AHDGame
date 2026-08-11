import { describe, expect, it } from "vitest";
import { COUNTRY_ORDER } from "@/lib/constants/countries";
import { loadSeededStateMetrics } from "@/lib/states/conditions/seedMetricsLoader";
import { buildFlatMetrics } from "@/lib/utils/governmentApproval";
import { evaluateModifiers } from "@/lib/utils/approvalModifiers";

const PRESETS = ["2019-default", "1991-default"] as const;
/** No single badge should blanket almost every region in a country. */
const MAX_REGION_FIRE_RATE = 0.84;

/**
 * Countries added for the 1979 Cold-War preset only — they are not part of the
 * 2019/1991 rosters this audit covers (no state-metrics bundle in those eras), so
 * the per-region flat-badge check doesn't apply here. Audited under 1979 instead
 * once that preset is added to PRESETS.
 */
const ERA_1979_ONLY = new Set<string>([
  // RU (the Russia/USSR entity) is only seeded in 1979 (modern Russia's regions
  // are a deferred build); skip it for non-1979 presets in the seed audit.
  "RU",
  "FR",
  "IT",
  "ES",
  "SE",
  "TR",
  "DD",
  "HU",
  "PL",
  "RO",
  "YU",
  "BG",
  "BLR",
  "CS",
  "BAL",
  // Cold-War additions — like the rest of this set they have no state-metrics
  // bundle in the 2019/1991 rosters (loadSeededStateMetrics returns []).
  "GR",
  "AT",
  "FI",
]);

describe("approvalModifiers — all countries seed audit", () => {
  for (const countryId of COUNTRY_ORDER) {
    for (const preset of PRESETS) {
      if (countryId === "NG" && preset === "1991-default") continue;
      if (ERA_1979_ONLY.has(countryId)) continue;

      it(`${countryId} ${preset}: no modifier fires on >${MAX_REGION_FIRE_RATE * 100}% of regions`, () => {
        const bundle = loadSeededStateMetrics(countryId, preset);
        expect(bundle.length).toBeGreaterThan(0);

        const counts = new Map<string, number>();
        for (const metrics of bundle) {
          const active = evaluateModifiers(buildFlatMetrics(metrics), { preset, countryId });
          for (const mod of active) {
            counts.set(mod.id, (counts.get(mod.id) ?? 0) + 1);
          }
        }

        const cap = Math.ceil(bundle.length * MAX_REGION_FIRE_RATE);
        for (const [id, count] of counts) {
          expect(count, `${id} fired on ${count}/${bundle.length} regions`).toBeLessThanOrEqual(
            cap
          );
        }
      });
    }
  }

  it("JP suppresses nationally flat life-expectancy badges", () => {
    const tokyo = loadSeededStateMetrics("JP", "2019-default").find((m) => m._id === "KAN");
    expect(tokyo).toBeDefined();
    const active = evaluateModifiers(buildFlatMetrics(tokyo!), {
      preset: "2019-default",
      countryId: "JP",
    });
    expect(active.some((m) => m.id === "high_life_expectancy")).toBe(false);
    expect(active.some((m) => m.id === "longevity")).toBe(false);
  });

  it("DE differentiates Länder on poverty and renewables", () => {
    const bundle = loadSeededStateMetrics("DE", "2019-default");
    const ids = new Set<string>();
    for (const m of bundle) {
      for (const mod of evaluateModifiers(buildFlatMetrics(m), {
        preset: "2019-default",
        countryId: "DE",
      })) {
        ids.add(mod.id);
      }
    }
    expect(
      ids.has("high_poverty") || ids.has("affordable_housing") || ids.has("green_transition")
    ).toBe(true);
  });

  it("US 1991 suppresses broadband-era infrastructure badges", () => {
    const ca = loadSeededStateMetrics("US", "1991-default").find((m) => m._id === "CA");
    const active = evaluateModifiers(buildFlatMetrics(ca!), {
      preset: "1991-default",
      countryId: "US",
    });
    expect(active.some((m) => m.id === "high_broadband")).toBe(false);
    expect(active.some((m) => m.id === "infrastructure_boom")).toBe(false);
  });
});
