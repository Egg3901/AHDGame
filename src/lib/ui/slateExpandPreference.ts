const KEY = "ahd:slate-race-expanded";

/** The viewer's last choice for race slate cards, or null when they never chose. */
export function readSlateExpandedPreference(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw === "1" ? true : raw === "0" ? false : null;
  } catch {
    return null;
  }
}

export function writeSlateExpandedPreference(expanded: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, expanded ? "1" : "0");
  } catch {
    // quota or private mode: the choice just is not remembered
  }
}
