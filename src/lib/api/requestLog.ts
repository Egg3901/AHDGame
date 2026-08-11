/**
 * Simple request logging for API routes.
 * Logs method, path, status, and duration. Disabled in production by default
 * unless LOG_REQUESTS=1 is set.
 */

const ENABLED = process.env.NODE_ENV !== "production" || process.env.LOG_REQUESTS === "1";

export function logRequest(method: string, path: string, status: number, durationMs: number): void {
  if (!ENABLED) return;
  const msg = `[API] ${method} ${path} ${status} ${durationMs}ms`;
  if (status >= 500) {
    console.error(msg);
  } else if (status >= 400) {
    console.warn(msg);
  } else {
    console.info(msg);
  }
}
