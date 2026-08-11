import type { EditorStateConfig, EraId } from "./types";

export function overrideKey(era: EraId, country: string, state: string): string {
  return `posed:${era}:${country}:${state}`;
}

export function loadOverride(era: EraId, country: string, state: string): EditorStateConfig | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(overrideKey(era, country, state));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EditorStateConfig;
  } catch {
    return null;
  }
}

export function saveOverride(cfg: EditorStateConfig): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    overrideKey(cfg.era, cfg.countryId, cfg.stateId),
    JSON.stringify(cfg)
  );
}

export function clearOverride(era: EraId, country: string, state: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(overrideKey(era, country, state));
}

/** All override configs for a country+era (used by the map to overlay edits). */
export function listOverrides(era: EraId, country: string): EditorStateConfig[] {
  if (typeof window === "undefined") return [];
  const prefix = `posed:${era}:${country}:`;
  const out: EditorStateConfig[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && k.startsWith(prefix)) {
      const v = window.localStorage.getItem(k);
      if (v) {
        try {
          out.push(JSON.parse(v) as EditorStateConfig);
        } catch {
          /* skip corrupt */
        }
      }
    }
  }
  return out;
}
