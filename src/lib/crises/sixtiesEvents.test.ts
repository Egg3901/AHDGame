import { describe, it, expect } from "vitest";
import {
  ALL_CRISIS_TEMPLATES,
  PRAGUE_SPRING_TEMPLATE,
  HARDLINER_BACKLASH_TEMPLATE,
  CIVIL_RIGHTS_MARCHES_TEMPLATE,
  CAMPUS_UNREST_TEMPLATE,
  URBAN_RIOTS_TEMPLATE,
  ANTIWAR_PROTEST_TEMPLATE,
} from "@/lib/crises/templates";
import { isTemplateAllowedInYear } from "@/lib/crises/crisisEraWindow";
import {
  WARSAW_PACT_SATELLITE_COUNTRY_IDS,
  WARSAW_PACT_BLOC_COUNTRY_IDS,
  USSR_COUNTRY_ID,
} from "@/lib/crises/warsawPactSatellites";
import { getVietnamEscalationLevel } from "@/lib/crises/vietnamEscalationInterface";
import type { CrisisDecisionOption } from "@/lib/db/types/crisis";

function allOptions(template: (typeof ALL_CRISIS_TEMPLATES)[string]): CrisisDecisionOption[] {
  return (template.interactionDefinition?.decisionTree ?? []).flatMap((n) => n.options ?? []);
}

describe("Warsaw Pact satellite constants", () => {
  it("does not include the USSR itself in the satellite list", () => {
    expect(WARSAW_PACT_SATELLITE_COUNTRY_IDS).not.toContain(USSR_COUNTRY_ID);
  });

  it("bloc list is the USSR plus every satellite, no duplicates", () => {
    expect(WARSAW_PACT_BLOC_COUNTRY_IDS).toContain(USSR_COUNTRY_ID);
    for (const sat of WARSAW_PACT_SATELLITE_COUNTRY_IDS) {
      expect(WARSAW_PACT_BLOC_COUNTRY_IDS).toContain(sat);
    }
    expect(new Set(WARSAW_PACT_BLOC_COUNTRY_IDS).size).toBe(WARSAW_PACT_BLOC_COUNTRY_IDS.length);
  });
});

describe("Vietnam escalation interface (Track A stub)", () => {
  it("returns a safe default of 0 until the real implementation lands", () => {
    expect(getVietnamEscalationLevel()).toBe(0);
  });
});

describe("registry wiring", () => {
  it("registers all six new templates under their keys", () => {
    expect(ALL_CRISIS_TEMPLATES.prague_spring_reform).toBe(PRAGUE_SPRING_TEMPLATE);
    expect(ALL_CRISIS_TEMPLATES.hardliner_backlash).toBe(HARDLINER_BACKLASH_TEMPLATE);
    expect(ALL_CRISIS_TEMPLATES.civil_rights_marches).toBe(CIVIL_RIGHTS_MARCHES_TEMPLATE);
    expect(ALL_CRISIS_TEMPLATES.campus_unrest).toBe(CAMPUS_UNREST_TEMPLATE);
    expect(ALL_CRISIS_TEMPLATES.urban_riots).toBe(URBAN_RIOTS_TEMPLATE);
    expect(ALL_CRISIS_TEMPLATES.antiwar_protest).toBe(ANTIWAR_PROTEST_TEMPLATE);
  });
});

describe("Prague Spring reform movement", () => {
  it("is scoped to the USSR and its Warsaw Pact satellites, from 1960", () => {
    expect(PRAGUE_SPRING_TEMPLATE.fromYear).toBe(1960);
    expect(PRAGUE_SPRING_TEMPLATE.geo?.countries).toEqual(WARSAW_PACT_BLOC_COUNTRY_IDS);
  });

  it("era window is closed before 1960 and open after", () => {
    expect(isTemplateAllowedInYear(PRAGUE_SPRING_TEMPLATE, 1953)).toBe(false);
    expect(isTemplateAllowedInYear(PRAGUE_SPRING_TEMPLATE, 1968)).toBe(true);
  });

  it("has exactly the three canonical options: suppress, tolerate, reform", () => {
    const options = allOptions(PRAGUE_SPRING_TEMPLATE);
    const ids = options.map((o) => o.optionId).sort();
    expect(ids).toEqual(["response_reform", "response_suppress", "response_tolerate"].sort());
  });

  it("suppress hits western opinion hard and restores government control", () => {
    const suppress = allOptions(PRAGUE_SPRING_TEMPLATE).find(
      (o) => o.optionId === "response_suppress"
    )!;
    const western = suppress.effects.find((e) => e.metricCategory === "westernOpinion")!;
    const gov = suppress.effects.find(
      (e) => e.targetType === "approval" && e.metricCategory === "government"
    )!;
    expect(western.value).toBeLessThan(-5); // large negative, native units
    expect(gov.value).toBeGreaterThan(0); // control restored
  });

  it("tolerate spawns a cascade crisis in another satellite, not the same country", () => {
    const tolerate = allOptions(PRAGUE_SPRING_TEMPLATE).find(
      (o) => o.optionId === "response_tolerate"
    )!;
    expect(tolerate.action).toEqual({
      kind: "spawnFollowUpCrisis",
      templateKey: "prague_spring_reform",
      countryPool: "warsawPactSatellites",
      excludeCurrentCountry: true,
      chance: 0.5,
    });
  });

  it("genuine reform boosts reformer approval, costs stability, and spawns a backlash", () => {
    const reform = allOptions(PRAGUE_SPRING_TEMPLATE).find(
      (o) => o.optionId === "response_reform"
    )!;
    const reformers = reform.effects.find((e) => e.metricCategory === "reformers")!;
    const gov = reform.effects.find(
      (e) => e.targetType === "approval" && e.metricCategory === "government"
    )!;
    expect(reformers.value).toBeGreaterThan(0);
    expect(gov.value).toBeLessThan(0);
    expect(reform.action).toMatchObject({
      kind: "spawnFollowUpCrisis",
      templateKey: "hardliner_backlash",
      countryPool: "sameCountry",
    });
  });
});

describe("Hardliner Backlash follow-up", () => {
  it("is scoped to the same bloc and has no auto-trigger of its own", () => {
    expect(HARDLINER_BACKLASH_TEMPLATE.geo?.countries).toEqual(WARSAW_PACT_BLOC_COUNTRY_IDS);
    expect(HARDLINER_BACKLASH_TEMPLATE.autoTrigger).toBeUndefined();
  });
});

describe("1960s US protest templates", () => {
  const usTemplates = [
    CIVIL_RIGHTS_MARCHES_TEMPLATE,
    CAMPUS_UNREST_TEMPLATE,
    URBAN_RIOTS_TEMPLATE,
    ANTIWAR_PROTEST_TEMPLATE,
  ];

  it("are all scoped to the US only", () => {
    for (const t of usTemplates) {
      expect(t.geo?.countries).toEqual(["US"]);
    }
  });

  it("open at or after 1960 and (where set) close by 1972", () => {
    for (const t of usTemplates) {
      expect(t.fromYear).toBeGreaterThanOrEqual(1960);
      if (t.untilYear !== undefined) {
        expect(t.untilYear).toBeLessThanOrEqual(1972);
      }
    }
  });

  it("civil rights crackdown option splits approval by segment in opposite directions", () => {
    const crackdown = allOptions(CIVIL_RIGHTS_MARCHES_TEMPLATE).find(
      (o) => o.optionId === "response_crackdown"
    )!;
    const segregationist = crackdown.effects.find(
      (e) => e.metricCategory === "segregationistVoters"
    )!;
    const movement = crackdown.effects.find((e) => e.metricCategory === "civilRightsMovement")!;
    expect(segregationist.value).toBeGreaterThan(0);
    expect(movement.value).toBeLessThan(0);
  });

  it("civil rights crackdown can spawn urban riots as a follow-up", () => {
    const crackdown = allOptions(CIVIL_RIGHTS_MARCHES_TEMPLATE).find(
      (o) => o.optionId === "response_crackdown"
    )!;
    expect(crackdown.action).toMatchObject({
      kind: "spawnFollowUpCrisis",
      templateKey: "urban_riots",
    });
  });

  it("civil rights legislation option introduces a real concession bill", () => {
    const legislate = allOptions(CIVIL_RIGHTS_MARCHES_TEMPLATE).find(
      (o) => o.optionId === "response_legislate"
    )!;
    expect(legislate.action).toMatchObject({ kind: "concessionBill" });
  });

  it("campus crackdown splits youth and conservative approval oppositely", () => {
    const crackdown = allOptions(CAMPUS_UNREST_TEMPLATE).find(
      (o) => o.optionId === "response_crackdown"
    )!;
    const youth = crackdown.effects.find((e) => e.metricCategory === "youthVoters")!;
    const conservative = crackdown.effects.find((e) => e.metricCategory === "conservativeVoters")!;
    expect(youth.value).toBeLessThan(0);
    expect(conservative.value).toBeGreaterThan(0);
  });

  it("urban unrest crackdown splits community and law-and-order approval oppositely", () => {
    const crackdown = allOptions(URBAN_RIOTS_TEMPLATE).find(
      (o) => o.optionId === "response_crackdown"
    )!;
    const community = crackdown.effects.find((e) => e.metricCategory === "urbanCommunities")!;
    const lawOrder = crackdown.effects.find((e) => e.metricCategory === "lawAndOrderVoters")!;
    expect(community.value).toBeLessThan(0);
    expect(lawOrder.value).toBeGreaterThan(0);
  });

  it("anti-war crackdown splits anti-war and hawkish approval oppositely", () => {
    const crackdown = allOptions(ANTIWAR_PROTEST_TEMPLATE).find(
      (o) => o.optionId === "response_crackdown"
    )!;
    const antiWar = crackdown.effects.find((e) => e.metricCategory === "antiWarVoters")!;
    const hawkish = crackdown.effects.find((e) => e.metricCategory === "hawkishVoters")!;
    expect(antiWar.value).toBeLessThan(0);
    expect(hawkish.value).toBeGreaterThan(0);
  });

  it("anti-war protest spawn chance is at or above its unescalated floor", () => {
    // With getVietnamEscalationLevel() stubbed to 0, the template should sit at
    // its documented floor (0.0015). This locks the floor value so a future
    // change to the interface's default doesn't silently drop it.
    const trig = ANTIWAR_PROTEST_TEMPLATE.autoTrigger;
    expect(trig?.kind).toBe("random");
    if (trig?.kind === "random") {
      expect(trig.spawnChance).toBeCloseTo(0.0015);
    }
  });
});
