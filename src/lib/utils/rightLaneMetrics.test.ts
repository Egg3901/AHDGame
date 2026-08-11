import { describe, it, expect } from "vitest";
import { axisAffinityFor } from "./metricAxisAffinity";
import { effectiveMetricWeight, APPROVAL_EXCLUDED_METRICS } from "./governmentApproval";
import { evaluateModifiers } from "./approvalModifiers";
import { THRESHOLDS } from "./metricScoring";
import { metricCategories } from "@/lib/constants/metricDefinitions";
import {
  UNIFORM_METRIC_PATHS,
  uniformMetricDefault,
  withUniformMetricSet,
} from "@/lib/seeds/shared/uniformStateMetrics";
import {
  usMetricPresets2019,
  usMetricPresets1991,
  US_AUTHORED_METRIC_PATHS,
} from "@/lib/seeds/reference/usMetricPresets";
import { usMetricPresets1953 } from "@/lib/seeds/reference/usMetricPresets1953";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";
import { deLegislationTypes } from "@/lib/seeds/de/deLegislationTypes";
import { calculatePolicyContribution } from "@shared/constants/formulas";
import type { StateDemographicGroup } from "@/lib/db/types/demographics";
import type { StateMetrics } from "@/lib/db/types";

/**
 * Right-lane axis metrics (firearmRights, borderSecurity): definitions, era
 * baselines, axis-affinity direction, two-sided law wiring, badge
 * reachability, and the no-dash copy rule.
 */

const NEW_METRICS = [
  { category: "publicSafety", id: "firearmRights" },
  { category: "governance", id: "borderSecurity" },
] as const;

function findDef(category: string, id: string) {
  return metricCategories.find((c) => c.id === category)?.metrics.find((m) => m.id === id);
}

function findLaw(id: string) {
  return legislationTypes.find((l) => l._id === id);
}

function weightFor(
  law: { effectTargetsWeighted?: { metricCategoryId: string; metricId: string; weight: number }[] },
  category: string,
  metricId: string
): number | undefined {
  return law.effectTargetsWeighted?.find(
    (t) => t.metricCategoryId === category && t.metricId === metricId
  )?.weight;
}

function group(economicLean: number, socialLean: number): StateDemographicGroup {
  return { population: 1000, economicLean, socialLean };
}

describe("right-lane metric definitions", () => {
  it("both metrics are defined, 0-100, higher-is-better", () => {
    for (const { category, id } of NEW_METRICS) {
      const def = findDef(category, id);
      expect(def, `${category}.${id}`).toBeTruthy();
      expect(def!.isHigherBetter).toBe(true);
      expect(def!.minValue).toBe(0);
      expect(def!.maxValue).toBe(100);
    }
  });

  it("both carry UI scoring thresholds", () => {
    expect(THRESHOLDS.firearmRights).toBeTruthy();
    expect(THRESHOLDS.borderSecurity).toBeTruthy();
  });

  it("neither is excluded from approval scoring", () => {
    expect(APPROVAL_EXCLUDED_METRICS.has("firearmRights")).toBe(false);
    expect(APPROVAL_EXCLUDED_METRICS.has("borderSecurity")).toBe(false);
  });

  it("player copy carries no em or en dashes", () => {
    for (const { category, id } of NEW_METRICS) {
      const def = findDef(category, id)!;
      expect(def.name).not.toMatch(/[–—]/);
      expect(def.description ?? "").not.toMatch(/[–—]/);
    }
  });
});

describe("right-lane axis affinity (P6d pattern, #2897 sign discipline)", () => {
  it("firearmRights is econ-right coded; borderSecurity is order coded", () => {
    expect(axisAffinityFor("firearmRights")).toEqual({ econ: 1, social: 0 });
    expect(axisAffinityFor("borderSecurity")).toEqual({ econ: 0, social: 1 });
  });

  it("right-leaning electorates up-weight firearmRights; left down-weight (never invert)", () => {
    const k = 1.3;
    const affinity = axisAffinityFor("firearmRights");
    const right = effectiveMetricWeight(affinity, [group(4, 0)], k);
    const left = effectiveMetricWeight(affinity, [group(-4, 0)], k);
    expect(right).toBeGreaterThan(1);
    expect(left).toBeLessThan(1);
    expect(left).toBeGreaterThanOrEqual(0); // floor rule: ignored, not inverted
  });

  it("authority-leaning electorates up-weight borderSecurity; liberal down-weight", () => {
    const k = 1.3;
    const affinity = axisAffinityFor("borderSecurity");
    expect(effectiveMetricWeight(affinity, [group(0, 4)], k)).toBeGreaterThan(1);
    const lib = effectiveMetricWeight(affinity, [group(0, -4)], k);
    expect(lib).toBeLessThan(1);
    expect(lib).toBeGreaterThanOrEqual(0);
  });
});

describe("right-lane seed baselines per era", () => {
  it("uniform defaults exist and are in bounds", () => {
    expect(UNIFORM_METRIC_PATHS).toContain("publicSafety.firearmRights");
    expect(UNIFORM_METRIC_PATHS).toContain("governance.borderSecurity");
    const bare = withUniformMetricSet({
      _id: "T1",
      economic: {},
      education: {},
      healthcare: {},
      infrastructure: {},
      publicSafety: {},
      environment: {},
      social: {},
      governance: {},
      population: {},
      mediaInformation: {},
      lastUpdated: new Date(0),
    } as unknown as StateMetrics);
    for (const path of ["publicSafety.firearmRights", "governance.borderSecurity"] as const) {
      const v = uniformMetricDefault(bare, path);
      expect(Number.isFinite(v), path).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(bare.publicSafety.firearmRights?.value).toBeGreaterThan(0);
    expect(bare.governance.borderSecurity?.value).toBeGreaterThan(0);
  });

  it("US authors both metrics in every era bundle", () => {
    expect(US_AUTHORED_METRIC_PATHS).toContain("publicSafety.firearmRights");
    expect(US_AUTHORED_METRIC_PATHS).toContain("governance.borderSecurity");
    for (const bundle of [usMetricPresets2019, usMetricPresets1991, usMetricPresets1953]) {
      for (const region of ["CA", "TX", "WY", "NY", "MS"]) {
        expect(bundle[region]?.["publicSafety.firearmRights"], region).toBeTypeOf("number");
        expect(bundle[region]?.["governance.borderSecurity"], region).toBeTypeOf("number");
      }
    }
  });

  it("era composition is historically ordered (looser firearm regimes further back)", () => {
    for (const region of ["CA", "TX", "OH"]) {
      const v1953 = usMetricPresets1953[region]["publicSafety.firearmRights"];
      const v1991 = usMetricPresets1991[region]["publicSafety.firearmRights"];
      const v2019 = usMetricPresets2019[region]["publicSafety.firearmRights"];
      expect(v1953).toBeGreaterThan(v1991);
      expect(v1991).toBeGreaterThan(v2019);
      // Quota-era entry control was tighter than the contemporary baseline.
      expect(usMetricPresets1953[region]["governance.borderSecurity"]).toBeGreaterThan(
        usMetricPresets2019[region]["governance.borderSecurity"]
      );
    }
  });
});

describe("right-lane law wiring (two-sided tradeoffs)", () => {
  it("us_gun_control: restriction lowers firearmRights, deregulation raises it", () => {
    const law = findLaw("us_gun_control")!;
    const w = weightFor(law, "publicSafety", "firearmRights");
    expect(w).toBe(-1.0);
    // Right option (effectDirection -1) raises the higher-is-better metric.
    expect(calculatePolicyContribution(-3, w!, 1.0, true)).toBeGreaterThan(0);
    // Left option (effectDirection +1) lowers it.
    expect(calculatePolicyContribution(3, w!, 1.0, true)).toBeLessThan(0);
    // Two-sidedness: the law still carries its crime-side wiring, so the
    // restriction path keeps its public-safety upside.
    expect(weightFor(law, "publicSafety", "crimeRate")).toBeTypeOf("number");
  });

  it("us_border_security_enforcement: restriction raises borderSecurity at an economicFreedom cost", () => {
    const law = findLaw("us_border_security_enforcement")!;
    const border = weightFor(law, "governance", "borderSecurity");
    const freedom = weightFor(law, "economic", "economicFreedom");
    expect(border).toBe(-1.0);
    expect(freedom).toBe(0.15);
    expect(calculatePolicyContribution(-3, border!, 1.0, true)).toBeGreaterThan(0);
    // The tradeoff: the same right option costs economicFreedom.
    expect(calculatePolicyContribution(-3, freedom!, 1.0, true)).toBeLessThan(0);
  });

  it("us_legal_immigration_visas and us_law_enforcement_criminal_justice carry borderSecurity levers", () => {
    expect(weightFor(findLaw("us_legal_immigration_visas")!, "governance", "borderSecurity")).toBe(
      -0.4
    );
    // Enforcement law codes right as effectDirection +1, so the weight is positive.
    expect(
      weightFor(findLaw("us_law_enforcement_criminal_justice")!, "governance", "borderSecurity")
    ).toBe(0.4);
  });

  it("DE immigration and asylum laws wire borderSecurity with restriction-raises sign", () => {
    for (const id of ["de_immigration_policy", "de_asylum_policy"]) {
      const law = deLegislationTypes.find((l) => l._id === id)!;
      const w = weightFor(law, "governance", "borderSecurity");
      expect(w, id).toBeTypeOf("number");
      expect(w!).toBeLessThan(0);
    }
  });
});

describe("right-lane badges (reachable at plausible values, #2898 lesson)", () => {
  const bundleAt = (firearmRights: number, borderSecurity: number) => ({
    publicSafety: { firearmRights },
    governance: { borderSecurity },
  });

  it("fire after one full-strength law swing from the authored US baselines", () => {
    // firearmRights: threshold 88 — 2019 SOUTH ~82 + state gun law swing (~+12) ≈ 94.
    // borderSecurity: SOUTH seed 58 + state enforcement posture (+4.8) = 62.8.
    const active = evaluateModifiers(bundleAt(88, 62.8));
    const ids = new Set(active.map((m) => m.id));
    expect(ids.has("broad_firearm_rights")).toBe(true);
    expect(ids.has("secure_border")).toBe(true);
  });

  it("do not fire at the untouched 2019 national averages", () => {
    const active = evaluateModifiers(bundleAt(68, 52));
    const ids = new Set(active.map((m) => m.id));
    expect(ids.has("broad_firearm_rights")).toBe(false);
    expect(ids.has("secure_border")).toBe(false);
  });

  it("badge labels carry no em or en dashes", () => {
    const active = evaluateModifiers(bundleAt(100, 100));
    for (const m of active) expect(m.label).not.toMatch(/[–—]/);
  });
});
