import { describe, expect, it } from "vitest";
import {
  foreignPolicyActionAllowed,
  foreignPolicyModeFrom,
  foreignPolicyStageFrom,
} from "../foreignPolicyRollout";

describe("foreign policy rollout defaults", () => {
  it("activates only organization votes when rollout fields are absent", () => {
    expect(foreignPolicyModeFrom(undefined)).toBe("active");
    const stage = foreignPolicyStageFrom(undefined);
    expect(stage).toBe("votes");
    expect(foreignPolicyActionAllowed("vote_org_yes", stage)).toBe(true);
    expect(foreignPolicyActionAllowed("propose_fta", stage)).toBe(false);
    expect(foreignPolicyActionAllowed("raise_tariff", stage)).toBe(false);
    expect(foreignPolicyActionAllowed("join_war", stage)).toBe(false);
  });

  it("preserves explicit off and shadow modes", () => {
    expect(foreignPolicyModeFrom("off")).toBe("off");
    expect(foreignPolicyModeFrom("shadow")).toBe("shadow");
  });
});
