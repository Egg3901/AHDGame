/**
 * Per-device key stored in localStorage.
 *
 * Complements the existing tracking cookie by surviving cookie clears (a common
 * "fresh browser" reset that doesn't touch site storage). Purely a stable
 * random UUID — no entropy is derived from device traits, so two devices
 * cannot produce the same key by coincidence.
 *
 * Cleared by the user via "Clear site data" / Application → Storage. That is
 * intentional: a legitimate user wiping their browser deserves a fresh
 * identity, while an alt-account attempt typically leaves localStorage intact
 * because cookie-only clearing is the common evasion path.
 */

const DEVICE_KEY_STORAGE_KEY = "__ahd_device";

export const DEVICE_KEY_LENGTH = 36; // canonical UUID length

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for older browsers — non-cryptographic but still unique enough for grouping.
  const rand = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${rand(8)}-${rand(4)}-4${rand(3)}-${rand(4)}-${rand(12)}`;
}

/**
 * Read the device key from localStorage, generating and persisting one on
 * first use. Returns an empty string in non-browser contexts or when storage
 * access throws (private mode, blocked third-party storage, etc.) so callers
 * can simply omit the field rather than branching on errors.
 */
export function getOrCreateDeviceKey(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY_STORAGE_KEY);
    if (existing && isUuid(existing)) return existing;
    const fresh = generateUuid();
    window.localStorage.setItem(DEVICE_KEY_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return "";
  }
}
