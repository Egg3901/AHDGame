import { describe, expect, it } from "vitest";
import { DEFAULT_BROWSER_PREFERENCES, parseBrowserPreferences } from "./browserPreferences";

describe("parseBrowserPreferences", () => {
  it("uses smart defaults for untouched or malformed storage", () => {
    expect(parseBrowserPreferences(null)).toEqual(DEFAULT_BROWSER_PREFERENCES);
    expect(parseBrowserPreferences("{not json")).toEqual(DEFAULT_BROWSER_PREFERENCES);
  });

  it("preserves valid imported values and clamps volume", () => {
    expect(
      parseBrowserPreferences({
        reducedMotion: true,
        highContrast: true,
        language: "fr",
        gameSounds: false,
        masterVolume: 140.4,
        eventSounds: false,
        audioCustomized: true,
      })
    ).toEqual({
      reducedMotion: true,
      highContrast: true,
      language: "en",
      gameSounds: false,
      masterVolume: 100,
      eventSounds: false,
      audioCustomized: true,
    });
  });

  it("fills missing fields without discarding valid values", () => {
    expect(parseBrowserPreferences(JSON.stringify({ masterVolume: 24 }))).toEqual({
      ...DEFAULT_BROWSER_PREFERENCES,
      masterVolume: 24,
    });
  });
});
