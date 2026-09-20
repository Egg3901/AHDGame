import { describe, expect, it } from "vitest";
import {
  applyTrackDeltas,
  applyConflictOutcome,
  evaluateConflictTransitions,
  normalizeConflictState,
  resolveConflictParticipants,
  scheduledPressureDeltas,
} from "./engine";
import type { LivingConflictDef } from "./types";

const negotiatedDef: LivingConflictDef = {
  key: "peace_process",
  type: "geopolitical",
  name: "Peace Process",
  participants: { belligerents: [], neighbors: [], blocMembers: [], bystanders: [] },
  roleResolver: () => "bystander",
  tracks: {
    violence: { initial: 70, min: 0, max: 100 },
    settlement: { initial: 10, min: 0, max: 100 },
  },
  transitions: [
    {
      key: "open_talks",
      fromPhase: "stalemate",
      toPhase: "talks",
      priority: 20,
      conditions: [
        { track: "violence", max: 45 },
        { track: "settlement", min: 40 },
      ],
    },
    {
      key: "settle",
      fromPhase: "talks",
      toPhase: "agreement",
      toStatus: "settled",
      priority: 20,
      conditions: [{ track: "settlement", min: 80 }],
    },
    {
      key: "breakdown",
      fromPhase: "talks",
      toPhase: "stalemate",
      priority: 10,
      conditions: [{ track: "violence", min: 75 }],
    },
  ],
  scheduledPressures: [
    {
      key: "talks_pressure",
      fromYear: 1993,
      untilYear: 1995,
      everyTurns: 2,
      phaseKeys: ["stalemate"],
      trackDeltas: { violence: -5, settlement: 8 },
    },
  ],
  phases: [
    {
      level: 1,
      key: "stalemate",
      label: "Stalemate",
      summary: "Violence without a political route out.",
      advancePressure: 999,
      decisionTrees: {},
      events: [],
    },
    {
      level: 2,
      key: "talks",
      label: "Talks",
      summary: "Negotiations are under way.",
      advancePressure: 999,
      decisionTrees: {},
      events: [],
    },
    {
      level: 3,
      key: "agreement",
      label: "Agreement",
      summary: "A durable agreement has been reached.",
      advancePressure: 999,
      decisionTrees: {},
      events: [],
    },
  ],
};

describe("negotiated living conflicts", () => {
  it("normalizes a legacy document with active lifecycle and authored track defaults", () => {
    const state = normalizeConflictState(negotiatedDef, {
      defKey: negotiatedDef.key,
      hasOpened: true,
      phaseLevel: 1,
      intensity: 50,
      openedYear: 1991,
      pressure: {},
      phaseTurns: 4,
      totalTurns: 4,
      updatedAt: new Date(0),
    });

    expect(state.status).toBe("active");
    expect(state.tracks).toEqual({ violence: 70, settlement: 10 });
  });

  it("clamps named track changes to their authored bounds", () => {
    const state = normalizeConflictState(negotiatedDef, { defKey: negotiatedDef.key });
    const changed = applyTrackDeltas(negotiatedDef, state, {
      violence: 50,
      settlement: -30,
    });

    expect(changed.tracks).toEqual({ violence: 100, settlement: 0 });
  });

  it("moves forward when every authored condition is met", () => {
    let state = normalizeConflictState(negotiatedDef, {
      defKey: negotiatedDef.key,
      hasOpened: true,
      phaseLevel: 1,
    });
    state = applyTrackDeltas(negotiatedDef, state, { violence: -30, settlement: 35 });

    const result = evaluateConflictTransitions(negotiatedDef, state, 1994);

    expect(result.appliedTransitionKey).toBe("open_talks");
    expect(result.state.phaseLevel).toBe(2);
    expect(result.state.phaseTurns).toBe(0);
  });

  it("supports regression and terminal settlement from the same public seam", () => {
    const talks = normalizeConflictState(negotiatedDef, {
      defKey: negotiatedDef.key,
      hasOpened: true,
      phaseLevel: 2,
      tracks: { violence: 80, settlement: 50 },
    });
    const broken = evaluateConflictTransitions(negotiatedDef, talks, 1996);
    expect(broken.appliedTransitionKey).toBe("breakdown");
    expect(broken.state.phaseLevel).toBe(1);

    const agreementReady = {
      ...talks,
      tracks: { violence: 20, settlement: 85 },
    };
    const settled = evaluateConflictTransitions(negotiatedDef, agreementReady, 1998);
    expect(settled.appliedTransitionKey).toBe("settle");
    expect(settled.state.phaseLevel).toBe(3);
    expect(settled.state.status).toBe("settled");
  });

  it("emits scheduled pressure only inside its year, phase, and cadence gates", () => {
    const stalemate = normalizeConflictState(negotiatedDef, {
      defKey: negotiatedDef.key,
      hasOpened: true,
      phaseLevel: 1,
      totalTurns: 4,
    });

    expect(scheduledPressureDeltas(negotiatedDef, stalemate, 1994)).toEqual({
      violence: -5,
      settlement: 8,
    });
    expect(scheduledPressureDeltas(negotiatedDef, { ...stalemate, totalTurns: 5 }, 1994)).toEqual(
      {}
    );
    expect(scheduledPressureDeltas(negotiatedDef, stalemate, 1992)).toEqual({});
    expect(scheduledPressureDeltas(negotiatedDef, { ...stalemate, phaseLevel: 2 }, 1994)).toEqual(
      {}
    );
  });

  it("applies a response outcome to tracks, phase, and lifecycle", () => {
    const talks = normalizeConflictState(negotiatedDef, {
      defKey: negotiatedDef.key,
      hasOpened: true,
      phaseLevel: 2,
      tracks: { violence: 60, settlement: 40 },
    });

    const changed = applyConflictOutcome(negotiatedDef, talks, {
      trackDeltas: { violence: -25, settlement: 20 },
      nextConflictPhase: "stalemate",
      nextConflictStatus: "ceasefire",
    });

    expect(changed.tracks).toEqual({ violence: 35, settlement: 60 });
    expect(changed.phaseLevel).toBe(1);
    expect(changed.phaseTurns).toBe(0);
    expect(changed.status).toBe("ceasefire");
  });

  it("substitutes an authored fallback when a historical participant is absent", () => {
    const participants = resolveConflictParticipants(
      {
        ...negotiatedDef,
        participants: {
          belligerents: ["HISTORICAL_A", "IE"],
          backerA: "HISTORICAL_BACKER",
          neighbors: ["UK"],
          blocMembers: [],
          bystanders: [],
        },
        participantFallbacks: {
          HISTORICAL_A: ["SUCCESSOR_A", "SUCCESSOR_B"],
          HISTORICAL_BACKER: ["US", "FR"],
        },
      },
      new Set(["SUCCESSOR_B", "IE", "UK", "FR"])
    );

    expect(participants.belligerents).toEqual(["SUCCESSOR_B", "IE"]);
    expect(participants.backerA).toBe("FR");
    expect(participants.neighbors).toEqual(["UK"]);
  });
});
