import { describe, expect, it } from "vitest";
import type { LivingConflictState } from "./types";
import { normalizeCampaignState } from "./campaign";
import {
  applyConflictOutcome,
  evaluateConflictTransitions,
  normalizeConflictState,
} from "./engine";
import { PANDEMIC_DEF as def } from "./defs/pandemic";
import {
  advancePandemicState,
  pandemicResponseOutcome,
  pandemicVaccineReady,
  pandemicMortality,
  pandemicPoliticalEffects,
  pandemicParticipants,
  pandemicOpeningYear,
} from "./rules/pandemic";
import { advanceCohort } from "@/lib/demographics/cohortFlows";

const response = def.phases[0].events[0].response!;
const options = Object.values(response.decisionTrees).flatMap((n) => n?.options ?? []);
function state(tracks: Record<string, number> = {}, phaseLevel = 1) {
  return normalizeConflictState(def, {
    defKey: "pandemic",
    hasOpened: true,
    phaseLevel,
    openedYear: 2027,
    tracks,
  });
}
function run(strategy: "cooperation" | "delay" | "inaction" | "nationalism" | "relapse") {
  let s = state();
  const events: Array<{ turn: number; transition: string }> = [];
  let firstVaccine: number | null = null;
  for (let turn = 1; turn <= 768; turn++) {
    s = { ...s, totalTurns: turn, phaseTurns: s.phaseTurns + 1 };
    if (turn % 12 === 0) {
      let chosen = [
        "restrict",
        "targeted_controls",
        "research_pool",
        "expand_manufacturing",
        "covax",
      ];
      if (turn > 144)
        chosen = ["targeted_controls", "covax", "covax", "expand_manufacturing", "research_pool"];
      if (
        strategy === "inaction" ||
        (strategy === "delay" && turn < 120) ||
        (strategy === "relapse" && turn > 288 && turn < 672)
      )
        chosen = Array<string>(5).fill("defer");
      if (strategy === "nationalism")
        chosen = [
          "targeted_controls",
          "domestic_priority",
          "domestic_priority",
          "research_pool",
          "expand_manufacturing",
        ];
      const scores: Record<string, number> = {};
      for (const id of chosen) {
        const option = options.find((o) => o.optionId === id)!;
        for (const [key, value] of Object.entries(option.responseScores ?? {}))
          scores[key] = (scores[key] ?? 0) + value;
      }
      s = applyConflictOutcome(def, s, pandemicResponseOutcome(s, scores, 5, response.outcomes[0]));
    }
    s = advancePandemicState(s);
    if (pandemicVaccineReady(s) && firstVaccine === null) firstVaccine = turn;
    const result = evaluateConflictTransitions(def, s, 2027 + turn / 48);
    s = result.state;
    if (result.appliedTransitionKey) events.push({ turn, transition: result.appliedTransitionKey });
    for (const value of Object.values(s.tracks ?? {})) expect(value).toBeGreaterThanOrEqual(0);
    for (const value of Object.values(s.tracks ?? {})) expect(value).toBeLessThanOrEqual(100);
  }
  return { s, events, firstVaccine };
}

describe("pandemic mechanics", () => {
  it("normalizes stored keys and levels without resetting observed disease", () => {
    expect(def.phases.map((p) => p.level)).toEqual([1, 2, 3, 4, 5]);
    const legacy = state({ transmission: 100, healthCapacity: 68, immunity: 28 }, 2);
    expect(legacy.tracks).toMatchObject({ transmission: 100, researchInvestment: 0 });
    const next = advancePandemicState(legacy);
    expect(next.campaign!.consequences.casualties).toBeGreaterThan(0);
    expect(evaluateConflictTransitions(def, next, 2032).state.phaseLevel).toBe(3);
  });
  it("offers research, manufacturing and access to every materialized role", () => {
    for (const node of Object.values(response.decisionTrees)) {
      const ids = (node!.options ?? []).map((o) => o.optionId);
      for (const id of ["research_pool", "expand_manufacturing", "covax", "defer"])
        expect(ids).toContain(id);
    }
    expect(Object.values(response.defaultOptionIdByRole).every((id) => id === "defer")).toBe(true);
  });
  it("requires clinical time, research and manufacturing before vaccination", () => {
    const ready = { ...state({ vaccineResearch: 100, manufacturing: 100 }), totalTurns: 47 };
    expect(pandemicVaccineReady(ready)).toBe(false);
    expect(pandemicVaccineReady({ ...ready, totalTurns: 48 })).toBe(true);
    expect(
      pandemicVaccineReady({
        ...ready,
        totalTurns: 100,
        tracks: { vaccineResearch: 69, manufacturing: 100 },
      })
    ).toBe(false);
    const unfunded = advancePandemicState(state({ cooperation: 100 }));
    expect(unfunded.tracks?.vaccineResearch).toBe(0);
  });
  it("cooperation reduces harm and reaches endemic management; delay permits global spread", () => {
    const early = run("cooperation"),
      late = run("delay");
    expect(early.events.some((e) => e.transition === "early_containment")).toBe(true);
    expect(late.events.some((e) => e.transition === "global_spread")).toBe(true);
    expect(early.s.campaign!.consequences.casualties).toBeLessThan(
      late.s.campaign!.consequences.casualties
    );
    expect(early.s.phaseLevel).toBe(5);
    expect(late.s.phaseLevel).toBe(5);
    expect(early.firstVaccine).toBeGreaterThanOrEqual(48);
  });
  it("inaction remains dangerous without manufacturing free vaccines", () => {
    const result = run("inaction");
    expect(result.firstVaccine).toBeNull();
    expect(result.s.campaign!.consequences.casualties).toBeGreaterThan(0);
    expect(result.s.tracks?.variantWaves).toBe(8);
  });
  it("waning protection and variants can reopen a settled emergency", () => {
    const result = run("relapse");
    expect(result.events.some((e) => e.transition === "endemic_transition")).toBe(true);
    expect(result.events.some((e) => e.transition === "endemic_escape")).toBe(true);
  });
  it("unequal vaccination leaves more harm and different national access", () => {
    const equal = run("cooperation"),
      unequal = run("nationalism");
    expect(unequal.s.tracks?.distributionEquity).toBeLessThan(equal.s.tracks!.distributionEquity);
    expect(unequal.s.campaign!.consequences.casualties).toBeGreaterThan(
      equal.s.campaign!.consequences.casualties
    );
    const signal = {
      ...state({
        transmission: 60,
        immunity: 40,
        vaccineResearch: 100,
        manufacturing: 100,
        distributionEquity: 0,
        "vaccinePriority:US": 100,
      }),
      totalTurns: 100,
    };
    expect(pandemicMortality(signal, "US")).toBeLessThan(pandemicMortality(signal, "IE"));
  });
  it("restriction costs recover instead of accumulating permanent economic damage", () => {
    const restricted = advancePandemicState(
      state({ containmentPolicy: 100, supplyChainStrain: 70, restrictionFatigue: 70 })
    );
    expect(pandemicPoliticalEffects(restricted)["economy.productivity"]).toBeLessThan(0);
    let recovered: LivingConflictState = {
      ...restricted,
      tracks: { ...restricted.tracks, containmentPolicy: 0, transmission: 1, immunity: 100 },
    };
    for (let i = 0; i < 100; i++) recovered = advancePandemicState(recovered);
    expect(recovered.tracks!.supplyChainStrain).toBeLessThan(restricted.tracks!.supplyChainStrain);
  });
  it("excess mortality reaches actual cohort headcounts with a bounded death fraction", () => {
    const vector = { male: Array<number>(101).fill(1000), female: Array<number>(101).fill(1000) };
    const inputs = {
      replacementTFR: 2.06,
      birthRateIndex: 50,
      healthcare: {},
      netInternationalMigrants: 0,
      migrantShareMale: 0.5,
    };
    const ordinary = advanceCohort(vector, inputs, 1, 48);
    const pandemic = advanceCohort(vector, { ...inputs, excessMortalityAnnual: 0.012 }, 1, 48);
    expect(pandemic.flows.deaths).toBeGreaterThan(ordinary.flows.deaths);
    expect(pandemic.flows.deaths - ordinary.flows.deaths).toBeLessThanOrEqual(
      (202000 * 0.012) / 48
    );
    expect(pandemic.vector.male[50]).toBeLessThan(ordinary.vector.male[50]);
  });
  it("retains small cumulative casualties across stored campaign normalization", () => {
    let current = state({ transmission: 28 });
    let expected = 0;
    for (let turn = 1; turn <= 48; turn++) {
      current = {
        ...current,
        totalTurns: turn,
        campaign: normalizeCampaignState(current.campaign),
      };
      expected += pandemicMortality(current) * 18;
      current = advancePandemicState(current);
    }
    expect(current.tracks!.cumulativeMortalityIndex).toBeCloseTo(expected, 10);
    expect(current.campaign!.consequences.casualties).toBeCloseTo(expected, 10);
    expect(expected).toBeGreaterThan(0.1);
  });
  it("bounds malformed legacy inputs and disables closed outbreaks", () => {
    const malformed = {
      ...state(),
      tracks: { transmission: NaN, immunity: Infinity, healthCapacity: -20 },
    };
    expect(Number.isFinite(pandemicMortality(malformed))).toBe(true);
    expect(pandemicMortality({ ...malformed, status: "closed" })).toBe(0);
    expect(pandemicPoliticalEffects({ ...malformed, hasOpened: false })).toEqual({});
  });
  it("chooses an available stable origin without forcing China", () => {
    const available = new Set(["US", "UK", "DE", "IE"]);
    const selected = pandemicParticipants(available, 2027);
    expect(selected.belligerents).toHaveLength(1);
    expect(pandemicOpeningYear(selected)).toBeGreaterThanOrEqual(2018);
    expect(pandemicOpeningYear(selected)).toBeLessThanOrEqual(2020);
    expect(selected.belligerents).not.toContain("CN");
    expect(pandemicParticipants(available, 2032, selected.belligerents[0]).belligerents).toEqual(
      selected.belligerents
    );
  });
});
