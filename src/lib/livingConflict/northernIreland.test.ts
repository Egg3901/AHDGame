import { describe, expect, it } from "vitest";
import { NORTHERN_IRELAND_DEF } from "./defs/northernIreland";
import {
  applyConflictOutcome,
  emptyConflictState,
  evaluateConflictTransitions,
  normalizeConflictState,
  phaseFor,
} from "./engine";

function opened() {
  return normalizeConflictState(NORTHERN_IRELAND_DEF, {
    ...emptyConflictState(NORTHERN_IRELAND_DEF.key),
    hasOpened: true,
    status: "active",
    phaseLevel: 1,
    openedYear: 1991,
  });
}

function advance(state: ReturnType<typeof opened>, deltas: Record<string, number>) {
  const moved = applyConflictOutcome(NORTHERN_IRELAND_DEF, state, { trackDeltas: deltas });
  return evaluateConflictTransitions(NORTHERN_IRELAND_DEF, moved, 1998).state;
}

describe("Northern Ireland peace process", () => {
  it("opens in 1991 as an armed stalemate with a four-party negotiation", () => {
    expect(NORTHERN_IRELAND_DEF.fromYear).toBe(1991);
    expect(phaseFor(NORTHERN_IRELAND_DEF, 1)?.key).toBe("armed_stalemate");
    const nodes = NORTHERN_IRELAND_DEF.phases[0].events[0].negotiation?.decisionTree ?? [];
    expect(nodes.map((node) => node.nodeId)).toEqual([
      "uk_position",
      "irish_position",
      "unionist_position",
      "nationalist_position",
      "regional_executive_position",
    ]);
    expect(nodes.at(-1)?.requiredRegionIds).toEqual(["NIR"]);
  });

  it("uses separate real-bill ratification decisions in the agreement phase", () => {
    const agreement = NORTHERN_IRELAND_DEF.phases.find((phase) => phase.key === "agreement");
    const nodes = agreement?.events[0].negotiation?.decisionTree ?? [];
    expect(nodes.map((node) => node.requiredCountryIds?.[0])).toEqual(["UK", "IE"]);
    expect(nodes[0].options?.[1].action?.kind).toBe("livingConflictRatificationBill");
    expect(nodes[1].options?.[1].action?.kind).toBe("livingConflictRatificationBill");
  });

  it("can reach a broadly historical settlement without scripting it", () => {
    let state = opened();
    state = advance(state, { settlementMomentum: 25, legitimacy: 10 });
    expect(phaseFor(NORTHERN_IRELAND_DEF, state.phaseLevel)?.key).toBe("backchannels");
    state = advance(state, {
      violence: -30,
      unionistConsent: 20,
      nationalistConsent: 20,
    });
    expect(phaseFor(NORTHERN_IRELAND_DEF, state.phaseLevel)?.key).toBe("ceasefire");
    state = advance(state, { settlementMomentum: 30, legitimacy: 15 });
    expect(phaseFor(NORTHERN_IRELAND_DEF, state.phaseLevel)?.key).toBe("multiparty_talks");
    state = advance(state, {
      settlementMomentum: 40,
      unionistConsent: 20,
      nationalistConsent: 20,
      domesticConsent: 30,
    });
    expect(phaseFor(NORTHERN_IRELAND_DEF, state.phaseLevel)?.key).toBe("agreement");
    expect(state.status).toBe("settled");
  });

  it("can remain delayed when consent and momentum do not converge", () => {
    const state = advance(opened(), { settlementMomentum: 5, legitimacy: -5, violence: 5 });
    expect(phaseFor(NORTHERN_IRELAND_DEF, state.phaseLevel)?.key).toBe("armed_stalemate");
    expect(state.status).toBe("active");
  });

  it("can fail from talks back into prolonged conflict", () => {
    const talks = applyConflictOutcome(NORTHERN_IRELAND_DEF, opened(), {
      nextConflictPhase: "multiparty_talks",
      nextConflictStatus: "negotiating",
      trackDeltas: { violence: 20 },
    });
    const failed = evaluateConflictTransitions(NORTHERN_IRELAND_DEF, talks, 1998).state;
    expect(phaseFor(NORTHERN_IRELAND_DEF, failed.phaseLevel)?.key).toBe("armed_stalemate");
    expect(failed.status).toBe("active");
  });

  it("can relapse after settlement and later restore power sharing", () => {
    const settlement = applyConflictOutcome(NORTHERN_IRELAND_DEF, opened(), {
      nextConflictPhase: "power_sharing",
      nextConflictStatus: "settled",
      trackDeltas: { institutionalStability: 10 },
    });
    const relapse = evaluateConflictTransitions(NORTHERN_IRELAND_DEF, settlement, 2002).state;
    expect(phaseFor(NORTHERN_IRELAND_DEF, relapse.phaseLevel)?.key).toBe("fragile_settlement");
    const restored = advance(relapse, { institutionalStability: 50, domesticConsent: 30 });
    expect(phaseFor(NORTHERN_IRELAND_DEF, restored.phaseLevel)?.key).toBe("power_sharing");
    expect(restored.status).toBe("settled");
  });
});
