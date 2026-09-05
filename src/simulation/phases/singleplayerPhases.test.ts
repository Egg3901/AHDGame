import { describe, expect, it } from "vitest";
import {
  combinePhasePredicates,
  getSingleplayerPhasePredicate,
  SINGLEPLAYER_SKIP_PHASES,
} from "./singleplayerPhases";

/**
 * The risk with a phase denylist is not that it skips too little, it is that
 * it quietly stops simulating something. These pin both directions: the
 * anti-abuse scans are skipped in singleplayer, and nothing else is.
 */
describe("singleplayer phase filtering", () => {
  it("runs every phase when not in singleplayer", () => {
    expect(getSingleplayerPhasePredicate(false)).toBeUndefined();
  });

  it("skips the anti-abuse scans in singleplayer", () => {
    const shouldRun = getSingleplayerPhasePredicate(true)!;
    for (const phase of ["financialSuspectScan", "auditAnomalyScan", "suspiciousDetection"]) {
      expect(shouldRun(phase), phase).toBe(false);
    }
  });

  it("runs gameplay phases in singleplayer", () => {
    const shouldRun = getSingleplayerPhasePredicate(true)!;
    for (const phase of [
      "corporationTurn",
      "economicVitalSigns",
      "electionResolution",
      "nppActionProcessing",
      "bondTurn",
      "bankingTurn",
      // Record-keeping, not detection: player-facing history reads it.
      "activityLogging",
    ]) {
      expect(shouldRun(phase), phase).toBe(true);
    }
  });

  it("skips only detection, so the list cannot silently grow into gameplay", () => {
    // A denylist is safe only while it stays small and stays about abuse.
    expect(SINGLEPLAYER_SKIP_PHASES.size).toBe(3);
    for (const phase of SINGLEPLAYER_SKIP_PHASES) {
      expect(phase, phase).toMatch(/Scan|Detection/);
    }
  });
});

describe("combinePhasePredicates", () => {
  const notA = (p: string) => p !== "a";
  const notB = (p: string) => p !== "b";

  it("returns undefined when nothing has an opinion", () => {
    expect(combinePhasePredicates(undefined, undefined)).toBeUndefined();
  });

  it("passes a single predicate through unchanged", () => {
    expect(combinePhasePredicates(undefined, notA)).toBe(notA);
  });

  it("requires every predicate to allow the phase", () => {
    const shouldRun = combinePhasePredicates(notA, notB)!;
    expect(shouldRun("a")).toBe(false);
    expect(shouldRun("b")).toBe(false);
    expect(shouldRun("c")).toBe(true);
  });

  it("keeps a sim profile's filtering when singleplayer also filters", () => {
    // elections-only would skip corporationTurn; singleplayer skips the scans.
    // Running both must skip the union, not just one side's list.
    const electionsOnly = (p: string) => p !== "corporationTurn";
    const singleplayer = getSingleplayerPhasePredicate(true);
    const shouldRun = combinePhasePredicates(electionsOnly, singleplayer)!;

    expect(shouldRun("corporationTurn")).toBe(false);
    expect(shouldRun("auditAnomalyScan")).toBe(false);
    expect(shouldRun("electionResolution")).toBe(true);
  });
});
