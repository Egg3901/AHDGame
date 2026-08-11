import { describe, expect, it } from "vitest";
import { FEATURE_GATE_BOOLEAN_KEYS } from "@/app/api/admin/feature-gates/route";

describe("macroGrowthV1 feature gate", () => {
  it("is exposed as an admin-toggleable boolean flag", () => {
    expect(FEATURE_GATE_BOOLEAN_KEYS).toContain("macroGrowthV1");
  });
});
