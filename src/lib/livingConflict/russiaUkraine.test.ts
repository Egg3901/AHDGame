import { describe, expect, it } from "vitest";
import {
  applyConflictOutcome,
  evaluateConflictTransitions,
  normalizeConflictState,
} from "./engine";
import { RUSSIA_UKRAINE_DEF } from "./defs/russiaUkraine";
import { selectGlobalResponseOutcome } from "./globalResponse";
import { resolveConflictParticipants } from "./rules/participants";
import type { ConflictRole } from "./types";
import { russiaUkraineOutcome } from "./rules/russiaUkraineOutcome";

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
  function decision(choices: Array<[ConflictRole, string]>) {
    const response = RUSSIA_UKRAINE_DEF.phases[0].events[0].response!;
    const scores: Record<string, number> = {};
    for (const [role, optionId] of choices) {
      const option = response.decisionTrees[role]!.options!.find((o) => o.optionId === optionId)!;
      for (const [axis, value] of Object.entries(option.responseScores ?? {})) {
        scores[axis] = (scores[axis] ?? 0) + value;
      }
    }
    return selectGlobalResponseOutcome(response.outcomes, response.defaultOutcomeId, scores);
  }

  it("makes proxy escalation reachable from the single government's actual choice", () => {
    expect(decision([["backer_a", "ru_proxy"]]).outcomeId).toBe("proxy_conflict");
  });

  it("makes direct intervention reachable without requiring the victim to escalate", () => {
    expect(decision([["backer_a", "ru_invade"]]).outcomeId).toBe("broad_invasion");
  });

  it("does not let bystanders negotiate neutrality over both principals' objections", () => {
    expect(
      decision([
        ["backer_a", "ru_invade"],
        ["belligerent", "uk_mobilize"],
        ["backer_b", "us_talks"],
        ["neighbor", "mediate"],
        ["bloc", "eu_guarantees"],
        ["bystander", "nonaligned"],
        ["bystander", "nonaligned"],
      ]).outcomeId
    ).not.toBe("negotiated_neutrality");
  });

  it("gives a substituted principal its own decisions", () => {
    const participants = resolveConflictParticipants(
      RUSSIA_UKRAINE_DEF,
      new Set(["RU", "PL", "US", "DE"])
    );
    expect(RUSSIA_UKRAINE_DEF.roleResolver({ countryId: "PL", ...participants })).toBe(
      "belligerent"
    );
  });

  it("requires mobilization before broad war and retains concurrent assistance", () => {
    const catalog = RUSSIA_UKRAINE_DEF.phases[0].events[0].response!.outcomes;
    const selected = decision([["backer_a", "ru_invade"]]);
    const limited = russiaUkraineOutcome(stateAt("territorial_confrontation"), selected, catalog, {
      aid: 4,
      militaryAid: 4,
      sanctions: 8,
    });
    expect(limited.outcomeId).toBe("limited_incursion");
    expect(limited.trackDeltas).toMatchObject({
      westernAid: 4,
      sanctionsPressure: 8,
      displacement: 6,
    });
    expect(limited.tradeSanction).toMatchObject({ commodity: "oil", targetRole: "backer_a" });
    const broad = russiaUkraineOutcome(stateAt("mobilization"), selected, catalog, {});
    expect(broad.outcomeId).toBe("broad_invasion");
    expect(broad.trackDeltas!.displacement).toBeGreaterThan(limited.trackDeltas!.displacement);
  });

  it("does not turn sustained proxy pressure into direct invasion without that choice", () => {
    let state = stateAt("proxy_conflict");
    for (let window = 0; window < 30; window++) {
      state = applyConflictOutcome(RUSSIA_UKRAINE_DEF, state, outcome("proxy_conflict"));
      state = evaluateConflictTransitions(RUSSIA_UKRAINE_DEF, state, 2020).state;
    }
    expect(state.phaseLevel).toBe(3);
    expect(state.tracks?.directIntervention).toBe(0);
    expect(state.tracks?.displacement).toBeGreaterThan(0);
  });

  it("preserves a completed settlement under repeated reciprocal diplomacy", () => {
    let state = stateAt("armistice_reconstruction", { settlementMomentum: 90, escalationRisk: 0 });
    state.status = "settled";
    state = applyConflictOutcome(RUSSIA_UKRAINE_DEF, state, outcome("negotiated_neutrality"));
    expect(state.status).toBe("settled");
  });

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
