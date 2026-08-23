import { describe, expect, it } from "vitest";
import {
  COVERT_STAGES,
  discoveryChance,
  emptyCovertProgram,
  FUNDING_COST,
  STAGE_PROGRESS,
  stepCovertProgram,
  type CovertProgramState,
} from "./covertNuclear";

const NEVER = 0.999;

function funded(over: Partial<CovertProgramState> = {}): CovertProgramState {
  return { ...emptyCovertProgram(), funding: "steady", ...over };
}

describe("discoveryChance", () => {
  it("is zero at low suspicion and grows quadratically, capped", () => {
    expect(discoveryChance(0)).toBe(0);
    expect(discoveryChance(10)).toBe(0);
    expect(discoveryChance(60)).toBeCloseTo(0.018, 3);
    expect(discoveryChance(100)).toBe(0.05);
  });
});

describe("stepCovertProgram", () => {
  it("an unfunded programme makes no progress and cools", () => {
    const r = stepCovertProgram(funded({ funding: "none", suspicion: 5 }), 1e9, NEVER);
    expect(r.spent).toBe(0);
    expect(r.state.progress).toBe(0);
    expect(r.state.suspicion).toBeLessThan(5);
  });

  it("a funded turn spends, progresses and warms", () => {
    const r = stepCovertProgram(funded(), 1e9, NEVER);
    expect(r.spent).toBe(FUNDING_COST.steady);
    expect(r.state.progress).toBe(2);
    expect(r.state.suspicion).toBeGreaterThan(0);
  });

  it("a turn the treasury cannot fund stalls and cools instead", () => {
    const r = stepCovertProgram(funded({ suspicion: 10 }), FUNDING_COST.steady - 1, NEVER);
    expect(r.spent).toBe(0);
    expect(r.state.progress).toBe(0);
    expect(r.state.suspicion).toBeLessThan(10);
  });

  it("completes a stage and rolls progress over", () => {
    const r = stepCovertProgram(funded({ progress: STAGE_PROGRESS - 1 }), 1e9, NEVER);
    expect(r.stageCompleted).toBe(0);
    expect(r.state.stage).toBe(1);
    expect(r.state.progress).toBe(0);
  });

  it("completing the final stage banks the device and stops funding", () => {
    const last = funded({ stage: COVERT_STAGES.length - 1, progress: STAGE_PROGRESS - 1 });
    const r = stepCovertProgram(last, 1e9, NEVER);
    expect(r.justCompleted).toBe(true);
    expect(r.state.completed).toBe(true);
    expect(r.state.funding).toBe("none");
    const after = stepCovertProgram(r.state, 1e9, NEVER);
    expect(after.spent).toBe(0);
  });

  it("discovery cracks down: a stage lost, progress wiped, funding halted", () => {
    const hot = funded({ stage: 2, progress: 30, suspicion: 90, funding: "crash" });
    const r = stepCovertProgram(hot, 1e9, 0);
    expect(r.discovered).toBe(true);
    expect(r.state.stage).toBe(1);
    expect(r.state.progress).toBe(0);
    expect(r.state.funding).toBe("none");
    expect(r.state.suspicion).toBe(30);
    expect(r.state.exposureCount).toBe(1);
  });

  it("a patient trickle from zero suspicion is never discovered on turn one", () => {
    const r = stepCovertProgram(funded({ funding: "trickle" }), 1e9, 0);
    expect(r.discovered).toBe(false);
  });
});
