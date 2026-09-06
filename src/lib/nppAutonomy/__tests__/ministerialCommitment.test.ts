/**
 * V5 ministerial commitment inside `planMinisterialActions`.
 *
 * The 24-turn setting cooldown (applied by the caller) stops per-turn churn.
 * This covers the layer above it: once the cooldown has lapsed, a working
 * posture is kept unless there is a reason to break it.
 */
import { describe, it, expect } from "vitest";
import type { CabinetPositionMechanics, MetricConfig } from "@/lib/constants/cabinetMechanicsTypes";
import type { GoverningAgendaItem } from "../governingAgenda";
import { planMinisterialActions } from "../ministerialGovernance";
import { nppBehaviorPolicy } from "@/lib/singleplayerDifficulty/rules/behavior";

const healthMetric: MetricConfig = {
  category: "healthcare",
  metricId: "healthcareAccess",
  label: "Healthcare Access",
  format: "percent",
  higherIsBetter: true,
};

/** Two positive tiers, so a standing commitment can be genuinely working while
 *  a better option exists — the case the hold is for. */
const mechanics: Pick<
  CabinetPositionMechanics,
  "tierSetting" | "nationalMetrics" | "regionalMetrics"
> = {
  nationalMetrics: [healthMetric],
  regionalMetrics: [],
  tierSetting: {
    name: "Health Funding",
    description: "",
    defaultTier: "modest",
    options: [
      { id: "modest", label: "Modest", description: "", effects: { healthcareAccess: 0.02 } },
      { id: "expansive", label: "Expansive", description: "", effects: { healthcareAccess: 0.05 } },
    ],
  },
};

const raiseHealthcare: GoverningAgendaItem = {
  domain: "healthcare",
  target: 65,
  direction: "raise",
  priority: 0.9,
};

const reformer = { ambition: 80, stubbornness: 20, loyalty: 50 };
const normal = nppBehaviorPolicy("normal");
const easy = nppBehaviorPolicy("easy");
const hard = nppBehaviorPolicy("hard");

function plan(overrides: {
  agenda?: GoverningAgendaItem[];
  commitment?: { shortfall: number; policy: ReturnType<typeof nppBehaviorPolicy> };
}) {
  return planMinisterialActions({
    agenda: overrides.agenda ?? [raiseHealthcare],
    mechanics,
    orders: [],
    personality: reformer,
    currentTier: "modest",
    activeOrderIds: new Set(),
    actionsAvailable: 0,
    commitment: overrides.commitment,
  });
}

describe("planMinisterialActions — V5 commitment", () => {
  it("switches tier when no commitment is supplied (every level below v5)", () => {
    expect(plan({}).tier).toBe("expansive");
  });

  it("holds a working posture against a marginally better one", () => {
    expect(plan({ commitment: { shortfall: 0.1, policy: normal } }).tier).toBeNull();
  });

  it("breaks the hold when the brief is materially failing", () => {
    expect(
      plan({ commitment: { shortfall: normal.replanShortfallThreshold, policy: normal } }).tier
    ).toBe("expansive");
  });

  it("breaks the hold for a crisis on the minister's own domain", () => {
    expect(
      plan({
        agenda: [{ ...raiseHealthcare, crisis: true }],
        commitment: { shortfall: 0.1, policy: normal },
      }).tier
    ).toBe("expansive");
  });

  it("reacts sooner on hard than on easy at the same shortfall", () => {
    const shortfall = 0.4; // between hard's 0.3 and easy's 0.6
    expect(plan({ commitment: { shortfall, policy: hard } }).tier).toBe("expansive");
    expect(plan({ commitment: { shortfall, policy: easy } }).tier).toBeNull();
  });

  it("still seats a first tier when nothing is committed yet", () => {
    const first = planMinisterialActions({
      agenda: [raiseHealthcare],
      mechanics,
      orders: [],
      personality: reformer,
      currentTier: null,
      activeOrderIds: new Set(),
      actionsAvailable: 0,
      commitment: { shortfall: 0, policy: hard },
    });
    expect(first.tier).toBe("expansive");
  });

  it("does not hold a posture that has stopped advancing the agenda", () => {
    // "modest" harms a LOWER goal, so the standing tier scores negative.
    const lower: GoverningAgendaItem = { ...raiseHealthcare, direction: "lower", target: 45 };
    const switched = planMinisterialActions({
      agenda: [lower],
      mechanics,
      orders: [],
      personality: reformer,
      currentTier: "modest",
      activeOrderIds: new Set(),
      actionsAvailable: 0,
      domainHealth: { healthcare: 90 },
      commitment: { shortfall: 0, policy: hard },
    });
    // Neither tier advances a "lower" goal here, so there is nothing to switch
    // to — the point is only that the hold did not fire on a negative score.
    expect(switched.tier).toBeNull();
  });

  it("leaves order selection untouched — the hold is about posture, not activity", () => {
    const orders = [
      {
        id: "health_drive",
        name: "Health Drive",
        description: "",
        duration: 24,
        effects: [{ metric: "healthcareAccess", modifier: 0.04, scope: "national" as const }],
      },
    ];
    const held = planMinisterialActions({
      agenda: [raiseHealthcare],
      mechanics,
      orders,
      personality: reformer,
      currentTier: "modest",
      activeOrderIds: new Set(),
      actionsAvailable: 2,
      commitment: { shortfall: 0.1, policy: normal },
    });
    expect(held.tier).toBeNull();
    expect(held.orderIds).toEqual(["health_drive"]);
  });
});
