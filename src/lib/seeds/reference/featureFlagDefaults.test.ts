import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_STATE_FLAGS, missingGameStateFlagDefaults } from "./featureFlagDefaults";

describe("missingGameStateFlagDefaults", () => {
  it("returns every default for a missing or empty doc", () => {
    expect(missingGameStateFlagDefaults(null)).toEqual(DEFAULT_GAME_STATE_FLAGS);
    expect(missingGameStateFlagDefaults({})).toEqual(DEFAULT_GAME_STATE_FLAGS);
  });

  it("preserves an explicit false — a reset must not re-enable it", () => {
    const out = missingGameStateFlagDefaults({ autoDisastersEnabled: false });
    expect(out).not.toHaveProperty("autoDisastersEnabled");
    expect(out).toMatchObject({ forexEnabled: true, rpgStatsEnabled: true });
  });

  it("preserves an explicit true without rewriting it", () => {
    const out = missingGameStateFlagDefaults({ forexEnabled: true });
    expect(out).not.toHaveProperty("forexEnabled");
  });

  it("treats the NPP autonomy pair as one flag: legacy explicit disable wins", () => {
    const out = missingGameStateFlagDefaults({ nppAutonomyEnabled: false });
    expect(out).not.toHaveProperty("nppAutonomyLevel");
    expect(out).not.toHaveProperty("nppAutonomyEnabled");
  });

  it("does not downgrade a configured autonomy level", () => {
    const out = missingGameStateFlagDefaults({ nppAutonomyLevel: "v2" });
    expect(out).not.toHaveProperty("nppAutonomyLevel");
    expect(out).not.toHaveProperty("nppAutonomyEnabled");
  });

  it("fills the pair when neither key was ever touched", () => {
    const out = missingGameStateFlagDefaults({ forexEnabled: false });
    expect(out).toMatchObject({ nppAutonomyLevel: "v4", nppAutonomyEnabled: true });
  });

  it("seeds worldEventsEnabled on for a fresh world (World Events v1 Phase 4)", () => {
    expect(missingGameStateFlagDefaults(null)).toMatchObject({ worldEventsEnabled: true });
  });

  it("does not resurrect an explicit worldEventsEnabled: false on an existing world", () => {
    const out = missingGameStateFlagDefaults({ worldEventsEnabled: false });
    expect(out).not.toHaveProperty("worldEventsEnabled");
  });
});
