import { describe, expect, it } from "vitest";
import {
  readinessBaselineOf,
  POSTURE_READINESS_BASELINE,
  READINESS_DRIFT_STEP,
} from "./readinessDrift";
import { driftReadiness } from "@/lib/turn/militaryForceEffects";
import { TIER_FORCE_MODIFIER, aggregateForce } from "@/lib/constants/military";
import type { MilitaryUnit, Posture } from "@/lib/db/types/militaryUnit";

/**
 * Ticket #1140. The department-wide readiness tier used to scale only the in-memory
 * `avgReadiness` inside `aggregateForce`. No stored unit ever moved, so a player on
 * Elevated + High Alert paid 25% more upkeep and watched an unchanged roster. The tier now
 * scales the baseline units drift toward, and must NOT also be re-applied in the aggregate.
 */
const POSTURES: Posture[] = ["garrison", "standard", "forward", "alert"];

describe("readiness tier moves the baseline units drift toward", () => {
  it("elevated raises and reduced lowers every posture's target", () => {
    for (const posture of POSTURES) {
      const standard = readinessBaselineOf(posture, 0, "standard");
      expect(readinessBaselineOf(posture, 0, "elevated")).toBeGreaterThan(standard);
      expect(readinessBaselineOf(posture, 0, "reduced")).toBeLessThan(standard);
    }
  });

  it("an absent, null or unknown tier reads as standard", () => {
    for (const posture of POSTURES) {
      const standard = readinessBaselineOf(posture, 0, "standard");
      expect(readinessBaselineOf(posture)).toBe(standard);
      expect(readinessBaselineOf(posture, 0, null)).toBe(standard);
      expect(readinessBaselineOf(posture, 0, "not_a_tier")).toBe(standard);
      expect(readinessBaselineOf(posture, 0)).toBe(POSTURE_READINESS_BASELINE[posture]);
    }
  });

  it("caps at 100: elevated on High Alert would otherwise target 101", () => {
    const raw = POSTURE_READINESS_BASELINE.alert * TIER_FORCE_MODIFIER.elevated.readinessMult;
    expect(raw).toBeGreaterThan(100);
    expect(readinessBaselineOf("alert", 0, "elevated")).toBe(100);
  });

  it("the arrears suppression still applies on top of the tier", () => {
    expect(readinessBaselineOf("standard", 1, "elevated")).toBeLessThan(
      readinessBaselineOf("standard", 0, "elevated")
    );
  });

  it("drift walks toward the tier-scaled target, which is the reporter's case", () => {
    // A High Alert unit sitting at its standard-tier baseline of 92.
    const at = POSTURE_READINESS_BASELINE.alert;
    // Before the fix this returned 92 for every tier: the setting did nothing.
    expect(driftReadiness(at, "alert", 0, "standard")).toBe(at);
    expect(driftReadiness(at, "alert", 0, "elevated")).toBe(
      Math.min(at + READINESS_DRIFT_STEP, 100)
    );
    expect(driftReadiness(at, "alert", 0, "reduced")).toBe(at - READINESS_DRIFT_STEP);
  });
});

describe("aggregateForce does not double-count the tier", () => {
  const unit = (readiness: number): MilitaryUnit =>
    ({
      readiness,
      posture: "standard",
      personnel: 1000,
      basePower: 100,
      upkeepBase: 100,
      techTier: 1,
      vet: 1,
      strength: 100,
      maxStrength: 100,
      equipment: { weapons: 50, vehicles: 50, supplies: 50 },
    }) as unknown as MilitaryUnit;

  it("avgReadiness reports the stored readiness whatever the tier", () => {
    const units = [unit(70), unit(80)];
    for (const tier of ["reduced", "standard", "elevated", null]) {
      expect(aggregateForce(units, "US", tier).avgReadiness).toBe(75);
    }
  });

  it("upkeep still scales with the tier", () => {
    const units = [unit(70)];
    const standard = aggregateForce(units, "US", "standard").totalUpkeep;
    expect(aggregateForce(units, "US", "elevated").totalUpkeep).toBeGreaterThan(standard);
    expect(aggregateForce(units, "US", "reduced").totalUpkeep).toBeLessThan(standard);
  });
});
