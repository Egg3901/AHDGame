import { describe, it, expect } from "vitest";
import { GROUND_GAME_PRESETS, findGroundGamePreset } from "./groundGamePresets";

describe("ground game presets", () => {
  it("persuade presets author leanSwing, mobilize presets author turnoutPush", () => {
    expect(GROUND_GAME_PRESETS).toHaveLength(5);
    for (const p of GROUND_GAME_PRESETS) {
      if (p.effect === "persuade") {
        expect(typeof p.leanSwing).toBe("number");
        expect(p.turnoutPush).toBeUndefined();
      } else {
        expect(typeof p.turnoutPush).toBe("number");
        expect(p.leanSwing).toBeUndefined();
      }
      expect(typeof p.nominalSwing).toBe("number");
      expect(p.funds).toBeGreaterThan(0);
      expect(p.actions).toBeGreaterThan(0);
      expect(p.ps).toBeGreaterThan(0);
    }
  });
  it("authors the signed-off values", () => {
    expect(findGroundGamePreset("press_conference")!.leanSwing).toBe(0.5);
    expect(findGroundGamePreset("broadcast_ads")!.leanSwing).toBe(1.5);
    expect(findGroundGamePreset("doorstep_canvass")!.turnoutPush).toBe(5);
    expect(findGroundGamePreset("gotv_drive")!.turnoutPush).toBe(8);
    expect(findGroundGamePreset("mass_rally")!.turnoutPush).toBe(13);
  });
  it("looks up by id", () => {
    expect(findGroundGamePreset("mass_rally")?.label).toBe("Mass rally");
    expect(findGroundGamePreset("nope")).toBeUndefined();
  });
});
