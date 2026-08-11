import { describe, expect, it } from "vitest";
import { POLITICAL_METRIC_FAMILIES } from "../politicalMetrics/families";
import type { PoliticalMetricId } from "../politicalMetrics/types";
import { SEED_TAX_RATES_1953 } from "./seedTaxRates";
import type { LawLevel, PoliticalLaw } from "./types";
import { validateCatalog } from "./validate";

const levels = (base: number): [LawLevel, LawLevel, LawLevel, LawLevel, LawLevel] => [
  { name: "None", description: "d" },
  { name: "L1", description: "d", gdpCostFraction: base },
  { name: "L2", description: "d", gdpCostFraction: base * 2 },
  { name: "L3", description: "d", gdpCostFraction: base * 3 },
  { name: "L4", description: "d", gdpCostFraction: base * 4 },
];

function buildSyntheticCatalog(): PoliticalLaw[] {
  const metricIds = POLITICAL_METRIC_FAMILIES.map((f) => f.id);
  const primaries: PoliticalLaw[] = metricIds.map((metricId) => ({
    id: `us.${metricId}.primary`,
    countryId: "US",
    kind: "primary",
    targets: [{ metricId, weight: 1 }],
    title: "Test Act",
    description: "A test act.",
    category: metricId.split(".")[0] as PoliticalLaw["category"],
    allowedScope: "national",
    baselineLevel: 1,
    levels: levels(0.001),
  }));
  // 32 secondaries × 4 targets = 128 slots; metric i touched by secondaries
  // covering indexes so each metric lands in [2,3] touches.
  const secondaries: PoliticalLaw[] = [];
  for (let s = 0; s < 32; s++) {
    const targets = [0, 1, 2, 3].map((k) => ({
      metricId: metricIds[(s * 4 + k) % 63],
      weight: 0.4,
    }));
    secondaries.push({
      id: `us.sec.testLaw${s}`,
      countryId: "US",
      kind: "secondary",
      targets,
      title: "Test Program",
      description: "A test program.",
      category: targets[0].metricId.split(".")[0] as PoliticalLaw["category"],
      allowedScope: "national",
      baselineLevel: 0,
      levels: levels(0.0005),
    });
  }
  const tax: PoliticalLaw[] = Object.entries(SEED_TAX_RATES_1953.US).map(([taxType, rate]) => ({
    id: `us.tax.${taxType}`,
    countryId: "US",
    kind: "tax",
    targets: [],
    taxPolicy: {
      scope: "federal",
      taxType,
      minRate: 0,
      maxRate: Math.max(60, rate),
      step: taxType === "payrollTax" ? 0.5 : 1,
      baselineRate: rate,
      waypoints: [
        { rate: 0, label: "None" },
        { rate: Math.max(60, rate), label: "Max" },
      ],
    },
    title: "Test Tax",
    description: "A test tax.",
    category: "economy",
    allowedScope: "national",
  }));
  return [...primaries, ...secondaries, ...tax];
}

// 128 slots over 63 metrics: ceil pattern gives each metric 2 or 3 touches — verify
// the synthetic construction itself in the happy-path test.

describe("validateCatalog", () => {
  it("accepts a full synthetic catalog", () => {
    expect(validateCatalog(buildSyntheticCatalog(), "US")).toEqual([]);
  });

  it("rejects a missing primary", () => {
    const laws = buildSyntheticCatalog().filter(
      (l) => l.id !== "us.economy.workerSecurity.primary"
    );
    const errors = validateCatalog(laws, "US");
    expect(errors.some((e) => e.includes("economy.workerSecurity"))).toBe(true);
  });

  it("rejects a duplicate id", () => {
    const laws = buildSyntheticCatalog();
    laws.push({ ...laws[0] });
    expect(validateCatalog(laws, "US").some((e) => e.includes("duplicate"))).toBe(true);
  });

  it("rejects secondary coverage outside [2,3]", () => {
    const laws = buildSyntheticCatalog();
    // Add a 33rd secondary stacking 4 more touches on already-covered metrics.
    const targets = [0, 1, 2, 3].map((k) => ({
      metricId: POLITICAL_METRIC_FAMILIES[k].id,
      weight: 0.4,
    }));
    laws.push({
      id: "us.sec.overCovered",
      countryId: "US",
      kind: "secondary",
      targets,
      title: "Over",
      description: "d",
      category: "economy",
      allowedScope: "national",
      baselineLevel: 0,
      levels: levels(0.0005),
    });
    expect(validateCatalog(laws, "US").some((e) => e.includes("touched"))).toBe(true);
  });

  it("rejects level-0 cost or revenue terms", () => {
    const laws = buildSyntheticCatalog();
    const target = laws.find((l) => l.kind === "primary")!;
    target.levels![0] = { name: "None", description: "d", gdpCostFraction: 0.001 };
    expect(validateCatalog(laws, "US").some((e) => e.includes("level 0"))).toBe(true);
  });

  it("rejects out-of-band fractions, allowing RU infrastructure headroom", () => {
    const usLaws = buildSyntheticCatalog();
    const usTarget = usLaws.find((l) => l.kind === "primary")!;
    usTarget.levels![4] = { name: "L4", description: "d", gdpCostFraction: 0.2 };
    expect(validateCatalog(usLaws, "US").some((e) => e.includes("gdpCostFraction"))).toBe(true);

    // RU infrastructure-category law at 0.3 is inside its 0.35 band.
    const ruLaw: PoliticalLaw = {
      id: "ru.infrastructure.transit.primary",
      countryId: "RU",
      kind: "primary",
      targets: [{ metricId: "infrastructure.transit", weight: 1 }],
      title: "T",
      description: "d",
      category: "infrastructure",
      allowedScope: "both",
      baselineLevel: 1,
      levels: [
        { name: "None", description: "d" },
        { name: "L1", description: "d", gdpCostFraction: 0.1 },
        { name: "L2", description: "d", gdpCostFraction: 0.2 },
        { name: "L3", description: "d", gdpCostFraction: 0.25 },
        { name: "L4", description: "d", gdpCostFraction: 0.3 },
      ],
    };
    const ruErrors = validateCatalog([ruLaw], "RU");
    expect(ruErrors.some((e) => e.includes("gdpCostFraction"))).toBe(false);
  });

  it("rejects a tax law with levels or targets", () => {
    const laws = buildSyntheticCatalog();
    const tax = laws.find((l) => l.kind === "tax")!;
    tax.levels = levels(0.001);
    tax.targets = [{ metricId: "economy.fiscal" as PoliticalMetricId, weight: 0.5 }];
    const errors = validateCatalog(laws, "US");
    expect(errors.some((e) => e.includes("tax"))).toBe(true);
  });

  it("rejects a tax baseline off the SEED_TAX_RATES_1953 table", () => {
    const laws = buildSyntheticCatalog();
    const tax = laws.find((l) => l.id === "us.tax.incomeTax")!;
    tax.taxPolicy = { ...tax.taxPolicy!, baselineRate: 20 };
    expect(validateCatalog(laws, "US").some((e) => e.includes("SEED_TAX_RATES_1953"))).toBe(true);
  });

  it("rejects a tax baseline off the slider grid", () => {
    const laws = buildSyntheticCatalog();
    const tax = laws.find((l) => l.id === "us.tax.payrollTax")!;
    // baseline 3 with step 2 from min 0: 3/2 not integral
    tax.taxPolicy = { ...tax.taxPolicy!, step: 2 };
    expect(validateCatalog(laws, "US").some((e) => e.includes("grid"))).toBe(true);
  });

  it("rejects secondary weights and target counts out of range", () => {
    const laws = buildSyntheticCatalog();
    const sec = laws.find((l) => l.kind === "secondary")!;
    sec.targets = [{ metricId: sec.targets[0].metricId, weight: 0.9 }];
    const errors = validateCatalog(laws, "US");
    expect(errors.some((e) => e.includes("weight"))).toBe(true);
    expect(errors.some((e) => e.includes("target"))).toBe(true);
  });

  it("rejects calendar years and anchor symbols in player copy", () => {
    const laws = buildSyntheticCatalog();
    const a = laws.find((l) => l.kind === "primary")!;
    a.title = "The 1953 Act";
    const b = laws.find((l) => l.kind === "secondary")!;
    b.levels![1] = { ...b.levels![1], description: "costs ₳5 per head" };
    const errors = validateCatalog(laws, "US");
    expect(errors.some((e) => e.includes("year"))).toBe(true);
    expect(errors.some((e) => e.includes("₳"))).toBe(true);
  });

  it("rejects a wrong-country id prefix", () => {
    const laws = buildSyntheticCatalog();
    const a = laws.find((l) => l.kind === "primary")!;
    a.id = a.id.replace("us.", "uk.");
    expect(validateCatalog(laws, "US").some((e) => e.includes("prefix"))).toBe(true);
  });
});
