import { describe, expect, it } from "vitest";
import { demographicFlowBatchId, demographicRecoveryDecision } from "./flowReceipt";

describe("demographic flow receipt rules", () => {
  it("keys a receipt by reset epoch and turn", () => {
    expect(demographicFlowBatchId("world-a", 8)).toBe("world-a:demographicFlows:8");
    expect(demographicFlowBatchId("world-b", 8)).not.toBe(demographicFlowBatchId("world-a", 8));
  });

  it("reruns a missing new journal attempt but skips an unjournaled legacy partial phase", () => {
    expect(demographicRecoveryDecision("missing", true)).toBe("rerun");
    expect(demographicRecoveryDecision("missing", false)).toBe("skip-legacy");
    expect(demographicRecoveryDecision("ready", true)).toBe("resume-before-context");
    expect(demographicRecoveryDecision("complete", true)).toBe("skip");
  });
});
