import { describe, expect, it } from "vitest";
import { getAnomalyScanCadencePredicate } from "./anomalyScanCadence";
import { combinePhasePredicates, getSingleplayerPhasePredicate } from "./singleplayerPhases";
import { getSimTurnPhasePredicate } from "./simTurnProfiles";

describe("health snapshots are independent of abuse scan cadence", () => {
  it("runs shared-world health on each of ten consecutive turns", () => {
    for (let turn = 1; turn <= 10; turn++) {
      const predicate = combinePhasePredicates(
        getSimTurnPhasePredicate("full"),
        getSingleplayerPhasePredicate(false),
        getAnomalyScanCadencePredicate(turn, 3)
      );
      expect(predicate?.("gameHealthSnapshot") ?? true, `turn ${turn}`).toBe(true);
    }
  });

  it("preserves singleplayer's decision to skip production diagnostics", () => {
    for (let turn = 1; turn <= 10; turn++) {
      const predicate = combinePhasePredicates(
        getSingleplayerPhasePredicate(true),
        getAnomalyScanCadencePredicate(turn, 3)
      );
      expect(predicate?.("gameHealthSnapshot"), `turn ${turn}`).toBe(false);
    }
  });

  it("retains every-third-turn scanning for the three abuse detection phases", () => {
    for (let turn = 1; turn <= 10; turn++) {
      const predicate = getAnomalyScanCadencePredicate(turn, 3)!;
      for (const phase of ["financialSuspectScan", "auditAnomalyScan", "suspiciousDetection"]) {
        expect(predicate(phase), `${phase} at turn ${turn}`).toBe(turn % 3 === 0);
      }
    }
  });
});
