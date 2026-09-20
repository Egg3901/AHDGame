import { describe, expect, it } from "vitest";
import {
  applyConflictOutcome,
  evaluateConflictTransitions,
  normalizeConflictState,
} from "./engine";
import { RUSSIA_UKRAINE_DEF } from "./defs/russiaUkraine";

function stateAt(phaseKey: string, tracks: Record<string, number> = {}) {
  const phase = RUSSIA_UKRAINE_DEF.phases.find((candidate) => candidate.key === phaseKey);
  if (!phase) throw new Error(`Unknown phase: ${phaseKey}`);
  return normalizeConflictState(RUSSIA_UKRAINE_DEF, {
    defKey: RUSSIA_UKRAINE_DEF.key,
    hasOpened: true,
    openedYear: 2013,
    phaseLevel: phase.level,
    tracks,
  });
}

function outcome(id: string) {
  const found = RUSSIA_UKRAINE_DEF.phases[0].events[0].response?.outcomes.find(
    (candidate) => candidate.outcomeId === id
  );
  if (!found) throw new Error(`Unknown outcome: ${id}`);
  return found;
}

describe("Russia-Ukraine security crisis", () => {
  it("adapts absent principals through explicit fallbacks", () => {
    expect(RUSSIA_UKRAINE_DEF.participantFallbacks).toMatchObject({
      UKR: ["RU", "PL", "RO"],
      RU: ["CN"],
      US: ["UK", "FR"],
    });
  });

  it("allows negotiated accommodation before territorial war", () => {
    const negotiated = applyConflictOutcome(
      RUSSIA_UKRAINE_DEF,
      stateAt("alignment_crisis", { settlementMomentum: 48, escalationRisk: 35 }),
      outcome("negotiated_neutrality")
    );
    const result = evaluateConflictTransitions(RUSSIA_UKRAINE_DEF, negotiated, 2014);
    expect(result.appliedTransitionKey).toBe("early_accommodation");
    expect(result.state.status).toBe("settled");
  });

  it("supports a durable proxy conflict without forcing broad invasion", () => {
    const proxy = applyConflictOutcome(
      RUSSIA_UKRAINE_DEF,
      stateAt("territorial_confrontation", { separatistCapacity: 22 }),
      outcome("proxy_conflict")
    );
    const result = evaluateConflictTransitions(RUSSIA_UKRAINE_DEF, proxy, 2015);
    expect(result.appliedTransitionKey).toBe("proxy_war");
    expect(result.state.phaseLevel).toBe(3);
  });

  it("lets cohesive deterrence reverse mobilization", () => {
    const deterred = applyConflictOutcome(
      RUSSIA_UKRAINE_DEF,
      stateAt("mobilization", { deterrence: 58, allianceCohesion: 52 }),
      outcome("deterrence_holds")
    );
    const result = evaluateConflictTransitions(RUSSIA_UKRAINE_DEF, deterred, 2022);
    expect(result.appliedTransitionKey).toBe("deterrence_success");
    expect(result.state.status).toBe("ceasefire");
  });

  it("makes broad invasion contingent on coercion and failed deterrence", () => {
    const invaded = applyConflictOutcome(
      RUSSIA_UKRAINE_DEF,
      stateAt("mobilization", { escalationRisk: 68, deterrence: 50 }),
      outcome("broad_invasion")
    );
    const result = evaluateConflictTransitions(RUSSIA_UKRAINE_DEF, invaded, 2022);
    expect(result.appliedTransitionKey).toBe("invasion");
    expect(result.state.tracks).toMatchObject({ displacement: 18, infrastructureDamage: 16 });
  });

  it("requires accumulated weariness and diplomacy to end a prolonged war", () => {
    const settlement = applyConflictOutcome(
      RUSSIA_UKRAINE_DEF,
      stateAt("broad_war", { settlementMomentum: 55, warWeariness: 60 }),
      outcome("negotiated_neutrality")
    );
    const result = evaluateConflictTransitions(RUSSIA_UKRAINE_DEF, settlement, 2026);
    expect(result.appliedTransitionKey).toBe("armistice");
    expect(result.state.phaseLevel).toBe(6);
  });
});
