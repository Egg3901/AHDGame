import { describe, it, expect } from "vitest";
import {
  DEFAULT_NPP_BEHAVIOR_POLICY,
  GOAL_SLOT_CAP,
  narrowCandidateSlate,
  nppBehaviorPolicy,
} from "./behavior";
import { NPP_ACTIONS_PER_TURN, NPP_ACTION_CAP, singleplayerNppTuning } from "./index";

describe("nppBehaviorPolicy", () => {
  it("resolves an absent difficulty to normal", () => {
    expect(nppBehaviorPolicy(undefined)).toEqual(nppBehaviorPolicy("normal"));
    expect(DEFAULT_NPP_BEHAVIOR_POLICY).toEqual(nppBehaviorPolicy("normal"));
  });

  /**
   * The load-bearing property of this table. Every lever with a pre-V5
   * equivalent has to sit at its shipped value on `normal`, or "V4 Normal vs V5
   * Normal" stops isolating the V5 increment and the whole comparison matrix
   * measures two changes at once.
   */
  it("keeps normal at shipped parity for every lever with a pre-V5 equivalent", () => {
    const normal = nppBehaviorPolicy("normal");
    expect(normal.candidateLimit).toBeNull(); // every candidate evaluated
    expect(normal.minBillScore).toBe(0); // never declines to file
    expect(normal.reserveActionMult).toBe(0); // spends exactly as before
    expect(normal.oppositionCoordination).toBe(1); // OPPOSITION_BIAS_BASE unscaled
  });

  it("never hands out resources — that is the sibling resource table's job", () => {
    // Resource parity at normal, and the resource lever lives elsewhere. If a
    // resource field ever appears in the behavior policy this fails to compile.
    const normal = singleplayerNppTuning("normal");
    expect(normal.actionPointsPerTurn).toBe(NPP_ACTIONS_PER_TURN);
    expect(normal.actionPointCap).toBe(NPP_ACTION_CAP);
    expect(normal.fundMultiplier).toBe(1);
    expect(Object.keys(nppBehaviorPolicy("hard"))).toEqual(
      expect.not.arrayContaining(["actionPointsPerTurn", "actionPointCap", "fundMultiplier"])
    );
  });

  it("orders competence easy < normal < hard on every directional lever", () => {
    const easy = nppBehaviorPolicy("easy");
    const normal = nppBehaviorPolicy("normal");
    const hard = nppBehaviorPolicy("hard");

    // Tracks more standing goals.
    expect(easy.goalSlots).toBeLessThan(normal.goalSlots);
    expect(normal.goalSlots).toBeLessThan(hard.goalSlots);
    // Follows through for longer.
    expect(easy.goalHoldTurns).toBeLessThan(normal.goalHoldTurns);
    expect(normal.goalHoldTurns).toBeLessThan(hard.goalHoldTurns);
    // Reacts to a failing portfolio sooner (lower is more responsive).
    expect(easy.replanShortfallThreshold).toBeGreaterThan(normal.replanShortfallThreshold);
    expect(normal.replanShortfallThreshold).toBeGreaterThan(hard.replanShortfallThreshold);
    // Reads a wider slate before choosing.
    expect(easy.candidateLimit).not.toBeNull();
    expect(normal.candidateLimit).toBeNull();
    expect(hard.candidateLimit).toBeNull();
    // Declines weak bills; keeps funds in hand; holds the bloc together.
    expect(hard.minBillScore).toBeGreaterThan(normal.minBillScore);
    expect(hard.reserveActionMult).toBeGreaterThan(normal.reserveActionMult);
    expect(easy.oppositionCoordination).toBeLessThan(normal.oppositionCoordination);
    expect(normal.oppositionCoordination).toBeLessThan(hard.oppositionCoordination);
  });

  it("clamps goal slots to the hard cap at every difficulty", () => {
    for (const difficulty of ["easy", "normal", "hard"] as const) {
      const policy = nppBehaviorPolicy(difficulty);
      expect(policy.goalSlots).toBeGreaterThanOrEqual(1);
      expect(policy.goalSlots).toBeLessThanOrEqual(GOAL_SLOT_CAP);
    }
  });
});

describe("narrowCandidateSlate", () => {
  const candidates = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const keyOf = (candidate: string) => candidate;

  it("returns the input untouched when there is no limit", () => {
    expect(narrowCandidateSlate(candidates, keyOf, null, "salt")).toBe(candidates);
  });

  it("returns the input untouched when the limit is not binding", () => {
    expect(narrowCandidateSlate(candidates, keyOf, 8, "salt")).toBe(candidates);
    expect(narrowCandidateSlate(candidates, keyOf, 99, "salt")).toBe(candidates);
  });

  it("narrows to the limit and is deterministic for the same salt", () => {
    const first = narrowCandidateSlate(candidates, keyOf, 3, "US:5:100");
    const second = narrowCandidateSlate(candidates, keyOf, 3, "US:5:100");
    expect(first).toHaveLength(3);
    expect(first).toEqual(second);
  });

  /**
   * Truncating the caller's array order would pin an easy world to whatever the
   * database returned first, forever. The slate has to move between decisions.
   */
  it("rotates the slate between decisions", () => {
    const salts = ["US:5:100", "US:5:200", "US:5:300", "US:5:400"];
    const slates = salts.map((salt) => narrowCandidateSlate(candidates, keyOf, 3, salt).join(","));
    expect(new Set(slates).size).toBeGreaterThan(1);
  });

  it("does not depend on the caller's array order", () => {
    const forward = narrowCandidateSlate(candidates, keyOf, 3, "US:5:100");
    const reversed = narrowCandidateSlate([...candidates].reverse(), keyOf, 3, "US:5:100");
    expect([...forward].sort()).toEqual([...reversed].sort());
  });

  it("only ever removes candidates, never invents one", () => {
    const slate = narrowCandidateSlate(candidates, keyOf, 3, "US:5:100");
    for (const entry of slate) expect(candidates).toContain(entry);
  });
});
