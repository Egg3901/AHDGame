import { describe, expect, it } from "vitest";
import { DEFAULT_GAME_STATE_FLAGS } from "@/lib/seeds/reference/featureFlagDefaults";
import {
  DEFAULT_SINGLEPLAYER_FEATURE_FLAGS,
  SINGLEPLAYER_FEATURE_FLAGS,
} from "./singleplayerFeatureFlags";

describe("singleplayer creation feature catalog", () => {
  it("covers every player-facing boolean default and excludes internal experiment flags", () => {
    const expected = Object.entries(DEFAULT_GAME_STATE_FLAGS)
      .filter(
        ([key, value]) =>
          typeof value === "boolean" &&
          key !== "nppAutonomyEnabled" &&
          key !== "frontierEntryExperimentEnabled"
      )
      .map(([key]) => key)
      .sort();
    expect(SINGLEPLAYER_FEATURE_FLAGS.map(({ key }) => key).sort()).toEqual(expected);
    expect(Object.keys(DEFAULT_SINGLEPLAYER_FEATURE_FLAGS).sort()).toEqual(expected);
  });

  it("provides unique, player-readable controls with exact shipped defaults", () => {
    expect(new Set(SINGLEPLAYER_FEATURE_FLAGS.map(({ key }) => key)).size).toBe(
      SINGLEPLAYER_FEATURE_FLAGS.length
    );
    for (const option of SINGLEPLAYER_FEATURE_FLAGS) {
      expect(option.label.trim()).not.toBe("");
      expect(option.description.trim()).not.toBe("");
      expect(option.defaultEnabled).toBe(DEFAULT_GAME_STATE_FLAGS[option.key]);
    }
    expect(DEFAULT_SINGLEPLAYER_FEATURE_FLAGS.autoSectorSeedEnabled).toBe(false);
    expect(DEFAULT_SINGLEPLAYER_FEATURE_FLAGS.nppOffensiveInitiationEnabled).toBe(false);
    expect(DEFAULT_SINGLEPLAYER_FEATURE_FLAGS.nppOffensiveJoinEnabled).toBe(false);
  });
});
