import { describe, it, expect } from "vitest";
import type { EngineNodeContext } from "../types";
import {
  ROAD_FREIGHT_MAX_BONUS,
  ROAD_FREIGHT_MAX_PENALTY,
  ROAD_FREIGHT_REFERENCE_SHARE,
  freightLogisticsAdequacyTerm,
  roadConditionNode,
} from "./infrastructure";

/**
 * Ticket #1143: a player was building the logistics sector (freight over-supplied
 * in the region view) while Manufacturing was penalised for "low logistics,"
 * because logistics-sector output was not an input to `roadCondition` — the
 * metric `getRoadConditionMarginModifier` taxes every ROAD_CONDITION_SECTORS
 * corporation on. Mirrors `gridEnergyAdequacyTerm` (suggestion #90).
 */

const rows = (logisticsRevenue: number, otherRevenue: number) => [
  { revenue: logisticsRevenue, sectorType: "logistics" },
  { revenue: otherRevenue, sectorType: "manufacturing" },
];

describe("freightLogisticsAdequacyTerm", () => {
  it("is neutral at exactly the reference share", () => {
    const total = 1_000;
    const term = freightLogisticsAdequacyTerm(
      rows(total * ROAD_FREIGHT_REFERENCE_SHARE, total * (1 - ROAD_FREIGHT_REFERENCE_SHARE))
    );
    expect(term).toBeCloseTo(0, 10);
  });

  it("penalises a region with a thin logistics sector", () => {
    const total = 1_000;
    const logistics = total * ROAD_FREIGHT_REFERENCE_SHARE * 0.5;
    const term = freightLogisticsAdequacyTerm(rows(logistics, total - logistics));
    expect(term).toBeLessThan(0);
    expect(term).toBeGreaterThanOrEqual(-ROAD_FREIGHT_MAX_PENALTY);
  });

  it("bottoms out rather than collapsing when there is no logistics sector at all", () => {
    const term = freightLogisticsAdequacyTerm(rows(0, 1_000));
    expect(term).toBeCloseTo(-ROAD_FREIGHT_MAX_PENALTY, 10);
  });

  it("rewards building freight capacity — the ticket #1143 fix", () => {
    const total = 1_000;
    const thin = freightLogisticsAdequacyTerm(rows(10, total));
    const built = freightLogisticsAdequacyTerm(rows(120, total));
    expect(built).toBeGreaterThan(thin);
  });

  it("caps the bonus so freight cannot buy perfect roads", () => {
    const term = freightLogisticsAdequacyTerm(rows(900, 100));
    expect(term).toBeCloseTo(ROAD_FREIGHT_MAX_BONUS, 10);
  });

  it("is exactly neutral with no sector data, so unseen regions keep the old target", () => {
    expect(freightLogisticsAdequacyTerm([])).toBe(0);
    expect(freightLogisticsAdequacyTerm([{ revenue: 0, sectorType: "logistics" }])).toBe(0);
  });

  it("ignores malformed revenue rather than propagating NaN into the road target", () => {
    const term = freightLogisticsAdequacyTerm([
      { revenue: Number.NaN, sectorType: "logistics" },
      { revenue: 1_000, sectorType: "manufacturing" },
    ]);
    expect(Number.isFinite(term)).toBe(true);
    expect(term).toBeCloseTo(-ROAD_FREIGHT_MAX_PENALTY, 10);
  });
});

/**
 * Node-level wiring: the freight term must actually move the metric the corp
 * margin penalty reads, otherwise the ticket #1143 loop is still broken. Same
 * fixed spend + prior baseline in each case, only the sectorRevenueTax payload
 * differs — so any delta is the freight term.
 */
function roadCtx(payload: {
  owned: Array<{ revenue: number; sectorType?: string }>;
  unowned: Array<{ revenue: number; sectorType?: string }>;
}): EngineNodeContext {
  return {
    current: {},
    prev: { "infrastructure.roadCondition": 55 },
    prevSimBaseline: { "infrastructure.roadCondition": 55 },
    providers: { sectorRevenueTax: payload },
    spending: { infrastructure: 1000 },
    policyValue: NaN,
  };
}

describe("roadConditionNode — freight wiring (ticket #1143)", () => {
  const empty = { owned: [], unowned: [] };

  it("a freight-heavy region ends with better roads than a freight-thin one", () => {
    const heavy = roadConditionNode.compute!(
      roadCtx({
        owned: [
          { revenue: 200, sectorType: "logistics" },
          { revenue: 800, sectorType: "manufacturing" },
        ],
        unowned: [],
      })
    );
    const thin = roadConditionNode.compute!(
      roadCtx({
        owned: [
          { revenue: 10, sectorType: "logistics" },
          { revenue: 990, sectorType: "manufacturing" },
        ],
        unowned: [],
      })
    );
    expect(heavy).toBeGreaterThan(thin);
  });

  it("building freight lifts roads above the no-freight-sector baseline", () => {
    const noFreight = roadConditionNode.compute!(
      roadCtx({ owned: [{ revenue: 1000, sectorType: "manufacturing" }], unowned: [] })
    );
    const built = roadConditionNode.compute!(
      roadCtx({
        owned: [
          { revenue: 150, sectorType: "logistics" },
          { revenue: 850, sectorType: "manufacturing" },
        ],
        unowned: [],
      })
    );
    expect(built).toBeGreaterThan(noFreight);
  });

  it("is unchanged from the spend-only path when no provider payload is present", () => {
    const withEmptyPayload = roadConditionNode.compute!(roadCtx(empty));
    const noProviderCtx: EngineNodeContext = {
      current: {},
      prev: { "infrastructure.roadCondition": 55 },
      prevSimBaseline: { "infrastructure.roadCondition": 55 },
      providers: {},
      spending: { infrastructure: 1000 },
      policyValue: NaN,
    };
    const noProvider = roadConditionNode.compute!(noProviderCtx);
    // Empty rows → term 0 → identical to the region the provider cannot see.
    expect(withEmptyPayload).toBeCloseTo(noProvider, 10);
  });
});
