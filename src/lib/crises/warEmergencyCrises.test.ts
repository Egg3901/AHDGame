import { describe, expect, it } from "vitest";
import { WAR_EMERGENCY_CRISIS_TEMPLATES } from "./warEmergencyCrises";

describe("war emergency crisis balance", () => {
  it("makes civil defense fever a material shock to consumer margins", () => {
    const effect = WAR_EMERGENCY_CRISIS_TEMPLATES.war_civil_defense_fever.effects.find(
      (candidate) => candidate.targetType === "profitMargin" && candidate.sectorType === "retail"
    );

    expect(effect).toBeDefined();
    expect(effect!.value).toBeLessThanOrEqual(-15);
  });
});
