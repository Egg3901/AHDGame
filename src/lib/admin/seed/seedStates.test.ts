import { describe, expect, it } from "vitest";
import { states2027 } from "@/lib/seeds/reference/states2027";
import { getPresetFallbacks, resetPresetFallbacks } from "@/lib/seeds/presetSelector";
import { selectStatesBundleForPreset } from "./seedStates";

describe("selectStatesBundleForPreset", () => {
  it("selects the authored draft 2027 bundle without recording a fallback", () => {
    resetPresetFallbacks();

    expect(selectStatesBundleForPreset("2027-default")).toBe(states2027);
    expect(getPresetFallbacks()).toEqual([]);
  });
});
