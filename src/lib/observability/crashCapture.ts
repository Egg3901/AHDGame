import * as Sentry from "@sentry/nextjs";

/*
 * Process-level crash capture.
 *
 * Node's default behavior on `unhandledRejection` (since v15) and
 * `uncaughtException` is to terminate the process — silently if no Sentry
 * listener is registered. That's how the sandbox container can die without
 * leaving any breadcrumb in Sentry; the only signal is the cron going quiet.
 *
 * This installer attaches handlers that capture the error to Sentry, wait
 * for Sentry's flush to complete, then exit non-zero so Railway sees a
 * crash and restarts the container. Even if flush rejects, we still exit —
 * a hung crash handler is worse than a missed Sentry event.
 */

const FLUSH_TIMEOUT_MS = 2000;

export interface CrashCaptureDeps {
  process?: NodeJS.Process;
}

export function installCrashCapture(deps: CrashCaptureDeps = {}): void {
  const proc = deps.process ?? process;

  proc.on("unhandledRejection", async (reason) => {
    try {
      Sentry.captureException(reason, { tags: { source: "unhandledRejection" } });
      await Sentry.flush(FLUSH_TIMEOUT_MS);
    } catch {
      // Swallow — never let the crash handler itself throw.
    }
    proc.exit(1);
  });

  proc.on("uncaughtException", async (err) => {
    try {
      Sentry.captureException(err, { tags: { source: "uncaughtException" } });
      await Sentry.flush(FLUSH_TIMEOUT_MS);
    } catch {
      // Swallow — never let the crash handler itself throw.
    }
    proc.exit(1);
  });
}
