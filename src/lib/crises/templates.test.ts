import { describe, it, expect } from "vitest";
import {
  ALL_CRISIS_TEMPLATES,
  getTemplateDuration,
  RECESSION_TEMPLATE,
  TORNADO_TEMPLATE,
} from "@/lib/crises/templates";
import type { CrisisEffect } from "@/lib/db/types/crisis";

const VALID_METRIC_PATHS = new Set([
  "economic.gdpGrowth",
  "economic.unemploymentRate",
  "economic.medianIncome",
  "economic.smallBusinessFormation",
  "economic.consumerConfidence",
  "economic.investorConfidence",
  "economic.tradeBalance",
  "economic.costOfLiving",
  "economic.propertyValueIndex",
  "environment.renewableEnergy",
  "environment.airQuality",
  "infrastructure.infrastructureInvestmentGap",
  "infrastructure.powerGridReliability",
  "publicSafety.publicSafetyConfidence",
]);

function isValidMetricEffect(effect: CrisisEffect): boolean {
  if (effect.targetType !== "metric") return true;
  const path = `${effect.metricCategory}.${effect.metricField}`;
  return VALID_METRIC_PATHS.has(path);
}

describe("crisis templates", () => {
  describe("getTemplateDuration", () => {
    it("prefers durationByScope over durationTurns", () => {
      const template = {
        durationTurns: 10,
        durationByScope: { country: 6, global: 8 },
      };
      expect(getTemplateDuration(template as never, "country")).toBe(6);
      expect(getTemplateDuration(template as never, "global")).toBe(8);
    });

    it("falls back to durationTurns when scope is missing", () => {
      const template = { durationTurns: 7 };
      expect(getTemplateDuration(template as never, "region")).toBe(7);
    });

    it("returns null when neither is defined", () => {
      const template = {};
      expect(getTemplateDuration(template as never, "country")).toBeNull();
    });
  });

  describe("template registry", () => {
    it("includes the six new templates", () => {
      expect(ALL_CRISIS_TEMPLATES.currency_crisis).toBeDefined();
      expect(ALL_CRISIS_TEMPLATES.cyber_attack).toBeDefined();
      expect(ALL_CRISIS_TEMPLATES.drought_famine).toBeDefined();
      expect(ALL_CRISIS_TEMPLATES.housing_collapse).toBeDefined();
      expect(ALL_CRISIS_TEMPLATES.labor_strikes).toBeDefined();
      expect(ALL_CRISIS_TEMPLATES.debt_default_contagion).toBeDefined();
    });

    it("has at least 19 total templates", () => {
      expect(Object.keys(ALL_CRISIS_TEMPLATES).length).toBeGreaterThanOrEqual(19);
    });
  });

  describe("template validation", () => {
    for (const [key, template] of Object.entries(ALL_CRISIS_TEMPLATES)) {
      it(`${key} has required fields and a valid scope`, () => {
        expect(template.name).toBeTruthy();
        expect(template.description).toBeTruthy();
        expect(["global", "country", "region"]).toContain(template.scope);
        expect(template.effects.length).toBeGreaterThan(0);
      });

      it(`${key} effects target valid metric paths`, () => {
        for (const effect of template.effects) {
          expect(
            isValidMetricEffect(effect),
            `Dead metric path: ${effect.metricCategory}.${effect.metricField} (${effect.label})`
          ).toBe(true);
        }
      });

      it(`${key} resolves a duration for its primary scope`, () => {
        const duration = getTemplateDuration(template, template.scope);
        expect(duration === null || (duration > 0 && Number.isInteger(duration))).toBe(true);
      });
    }
  });

  // Regression guard for the fraction→native scale bug: templates author effect
  // magnitudes as fractional swings, but the turn engine applies them as a raw
  // $inc in native metric units. `fx()` converts at construction (×100 flat, ×30
  // tick) so the stored/displayed/applied values are all native. If a future edit
  // drops that conversion, effects silently revert to ~100× too small.
  describe("effect magnitudes are in native units", () => {
    it("scales a flat decision effect ×100 (a 2pp GDP hit, not 0.02)", () => {
      const stimulus = RECESSION_TEMPLATE.interactionDefinition!.decisionTree[0].options!.find(
        (o) => o.optionId === "stimulus_austerity"
      )!;
      const gdp = stimulus.effects.find((e) => e.metricField === "gdpGrowth")!;
      const approval = stimulus.effects.find((e) => e.targetType === "approval")!;
      expect(gdp.value).toBeCloseTo(-2); // -0.02 swing → -2 native
      expect(approval.value).toBeCloseTo(-5); // -0.05 swing → -5 native
    });

    it("scales a per-turn tick ×30 (a ~0.66pp/turn drag, not 0.022)", () => {
      const gdpTick = RECESSION_TEMPLATE.effects.find(
        (e) => e.metricField === "gdpGrowth" && e.effectType === "tick"
      )!;
      expect(gdpTick.value).toBeCloseTo(-0.66); // -0.022 swing → -0.66 native
    });

    it("leaves gdpLoss authored as a genuine GDP fraction (unscaled)", () => {
      const loss = TORNADO_TEMPLATE.effects.find((e) => e.targetType === "gdpLoss")!;
      expect(loss.value).toBeCloseTo(0.01); // fraction, NOT scaled to 1.0
    });

    it("every metric/approval/inflation effect lands on a native scale (|value| ≥ 0.1)", () => {
      const scaledTargets = new Set(["metric", "approval", "inflation"]);
      for (const [key, template] of Object.entries(ALL_CRISIS_TEMPLATES)) {
        const all: CrisisEffect[] = [
          ...template.effects,
          ...(template.interactionDefinition?.decisionTree ?? []).flatMap((n) => [
            ...(n.options ?? []).flatMap((o) => o.effects),
            ...(n.outcomeEffects ?? []),
          ]),
        ];
        for (const e of all) {
          if (!scaledTargets.has(e.targetType) || e.value === 0) continue;
          expect(
            Math.abs(e.value),
            `${key}: "${e.label}" is ${e.value} — looks un-scaled (fractional)`
          ).toBeGreaterThanOrEqual(0.1);
        }
      }
    });
  });
});

describe("P3.5 margin-shock physicality classification", () => {
  const marginShocks = Object.entries(ALL_CRISIS_TEMPLATES).flatMap(([key, t]) =>
    (t.effects ?? [])
      .filter((e: CrisisEffect) => e.effectType === "decay" && e.targetType === "profitMargin")
      .map((e: CrisisEffect) => ({ key, effect: e }))
  );

  it("classifies every authored margin shock explicitly", () => {
    expect(marginShocks.length).toBeGreaterThan(0);
    const unclassified = marginShocks
      .filter(({ effect }) => effect.physicality == null)
      .map(({ key }) => key);
    expect(unclassified).toEqual([]);
  });

  it("only ever uses the two known classifications", () => {
    for (const { effect } of marginShocks) {
      expect(["physical", "financial"]).toContain(effect.physicality);
    }
  });

  // The physical set is deliberately narrow: an event qualifies only when it
  // plainly stops output. Anything ambiguous stays financial (no tonnage change),
  // so this list is a lock, not a snapshot — adding to it is a design decision.
  it("holds the physical set to production-stopping events only", () => {
    const physical = marginShocks
      .filter(({ effect }) => effect.physicality === "physical")
      .map(({ key }) => key)
      .sort();
    expect(physical).toEqual(
      [
        "bridge_collapse",
        "industrial_accident",
        "labor_strikes",
        "port_closure",
        "power_grid_failure",
        "steel_strike",
        "supply_chain_disruption",
        // Three struck sectors, so the wildcat strike carries three physical
        // shocks: steel and cars stop being made, ports and freight stop
        // moving them.
        "union_ban_general_strike",
        "union_ban_general_strike",
        "union_ban_general_strike",
      ].sort()
    );
  });

  it("keeps the cost-side shocks financial so plants does not double-count inputs", () => {
    for (const key of ["inflation_spike", "energy_crisis", "currency_crisis", "trade_war"]) {
      const shocks = marginShocks.filter((m) => m.key === key);
      expect(shocks.length).toBeGreaterThan(0);
      for (const { effect } of shocks) expect(effect.physicality).toBe("financial");
    }
  });
});
