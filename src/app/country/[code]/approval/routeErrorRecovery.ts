const NETWORK_FETCH_MESSAGES = new Set([
  "network error",
  "failed to fetch",
  "load failed",
  "networkerror when attempting to fetch resource.",
  "the network connection was lost.",
]);

const NETWORK_RETRY_COOLDOWN_MS = 60_000;
const recentNetworkRetries = new Map<string, number>();

/** Recognize native fetch transport failures without matching ordinary TypeErrors. */
export function isNetworkFetchFailure(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== "TypeError") return false;
  return NETWORK_FETCH_MESSAGES.has(error.message.trim().toLowerCase());
}

/** Allow one automatic retry per route during a short transport-failure window. */
export function claimNetworkRetry(route: string, now = Date.now()): boolean {
  for (const [key, expiresAt] of recentNetworkRetries) {
    if (expiresAt <= now) recentNetworkRetries.delete(key);
  }

  if (recentNetworkRetries.has(route)) return false;

  // Keep this client-module guard bounded even if a session visits many routes.
  if (recentNetworkRetries.size >= 64) {
    const oldest = recentNetworkRetries.keys().next().value;
    if (oldest) recentNetworkRetries.delete(oldest);
  }

  recentNetworkRetries.set(route, now + NETWORK_RETRY_COOLDOWN_MS);
  return true;
}

export function clearNetworkRetry(route: string): void {
  recentNetworkRetries.delete(route);
}
