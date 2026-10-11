import { describe, it, expect } from "vitest";
import {
  computeIndependenceDesireDriftSnapshot as step,
  regionalApprovalDrift,
  nationalApprovalDrift,
  westminsterPolicyDrift,
  DEVOLUTION_POLICY_DRIFT,
  westminsterStanceChangeError,
  resolveWestminsterPolicy,
} from "./rules";

describe("Westminster constitutional stances", () => {
  it.each(["anti", "pro", "independence"] as const)(
    "has half the FM influence for %s",
    (policy) => {
      expect(westminsterPolicyDrift(policy)).toBe(DEVOLUTION_POLICY_DRIFT[policy] / 2);
      for (const approval of [0, 25, 49.9, 50, 50.1, 70, 100]) {
        expect(nationalApprovalDrift(approval, policy)).toBe(
          regionalApprovalDrift(approval, policy) / 2
        );
      }
    }
  );
  it("endorses a popular supportive government and reverses its approval effect when rejected", () => {
    const inputs = {
      previous: 35,
      policy: "pro" as const,
      regionalApproval: 50,
      inflationPercent: 3,
      westminsterPolicy: "independence" as const,
    };
    expect(step({ ...inputs, nationalApproval: 70 }).delta).toBe(0.042);
    expect(step({ ...inputs, nationalApproval: 30 }).delta).toBe(0.002);
    expect(step({ ...inputs, westminsterPolicy: "anti", nationalApproval: 70 }).delta).toBe(-0.043);
    expect(step({ ...inputs, westminsterPolicy: "pro", nationalApproval: 70 }).delta).toBe(-0.003);
  });
  it("defaults existing worlds to a unionist position", () => {
    expect(resolveWestminsterPolicy()).toBe("anti");
  });
  it("unlocks exactly at the cooldown boundary", () => {
    const args = {
      currentPolicy: "anti" as const,
      policy: "pro" as const,
      changedAtTurn: 100,
      currentTurn: 171,
      actions: 2,
    };
    expect(westminsterStanceChangeError(args)).toContain("172");
    expect(westminsterStanceChangeError({ ...args, currentTurn: 172 })).toBeNull();
    expect(westminsterStanceChangeError({ ...args, currentTurn: 172, actions: 1 })).toContain(
      "Insufficient"
    );
    expect(westminsterStanceChangeError({ ...args, policy: "anti" })).toContain("already");
  });
});
