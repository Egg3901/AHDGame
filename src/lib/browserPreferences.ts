export const BROWSER_PREFERENCES_STORAGE_KEY = "ahd-browser-preferences-v1";

export interface BrowserPreferences {
  reducedMotion: boolean;
  highContrast: boolean;
  language: "en";
  gameSounds: boolean;
  masterVolume: number;
  eventSounds: boolean;
  audioCustomized: boolean;
}

export const DEFAULT_BROWSER_PREFERENCES: BrowserPreferences = {
  reducedMotion: false,
  highContrast: false,
  language: "en",
  gameSounds: true,
  masterVolume: 70,
  eventSounds: true,
  audioCustomized: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Browser preferences are intentionally defensive because players can import
 * this JSON from another device (or edit localStorage by hand).
 */
export function parseBrowserPreferences(value: unknown): BrowserPreferences {
  const parsed =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return null;
          }
        })()
      : value;

  if (!isRecord(parsed)) return { ...DEFAULT_BROWSER_PREFERENCES };

  return {
    reducedMotion:
      typeof parsed.reducedMotion === "boolean"
        ? parsed.reducedMotion
        : DEFAULT_BROWSER_PREFERENCES.reducedMotion,
    highContrast:
      typeof parsed.highContrast === "boolean"
        ? parsed.highContrast
        : DEFAULT_BROWSER_PREFERENCES.highContrast,
    language: parsed.language === "en" ? "en" : DEFAULT_BROWSER_PREFERENCES.language,
    gameSounds:
      typeof parsed.gameSounds === "boolean"
        ? parsed.gameSounds
        : DEFAULT_BROWSER_PREFERENCES.gameSounds,
    masterVolume:
      typeof parsed.masterVolume === "number" && Number.isFinite(parsed.masterVolume)
        ? Math.round(Math.min(100, Math.max(0, parsed.masterVolume)))
        : DEFAULT_BROWSER_PREFERENCES.masterVolume,
    eventSounds:
      typeof parsed.eventSounds === "boolean"
        ? parsed.eventSounds
        : DEFAULT_BROWSER_PREFERENCES.eventSounds,
    audioCustomized:
      typeof parsed.audioCustomized === "boolean"
        ? parsed.audioCustomized
        : DEFAULT_BROWSER_PREFERENCES.audioCustomized,
  };
}
