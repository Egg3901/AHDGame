const SEEN_VALUE = "1";

export function readFeatureSeen(key: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(key) === SEEN_VALUE;
  } catch {
    return true;
  }
}

export function writeFeatureSeen(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, SEEN_VALUE);
  } catch {
    // quota / private mode — badge may reappear next visit
  }
}
