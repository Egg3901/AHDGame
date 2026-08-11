import * as Sentry from "@sentry/nextjs";
import { stopCronJobs } from "@/lib/cron";
import { releaseLocalProcessingLock } from "@/lib/turnSystem";
import { logger } from "../observability/logger";

/*
 * Graceful shutdown handler.
 *
 * Railway sends SIGTERM (then SIGKILL after a grace period) when it replaces a
 * container on redeploy. Without a handler, a redeploy that lands mid-turn
 * leaves `gameState.isProcessing = true` with a frozen heartbeat: no turn runs
 * until the 20-min stale takeover fires on a later cron tick — up to an hour of
 * wedged turns (2026-07 stuck-turn incident, driven by rapid redeploy churn).
 *
 * On the signal we: stop cron (no new ticks race the shutdown), release THIS
 * process's in-flight turn lock so the next container picks up immediately,
 * flush Sentry, and exit. Everything is time-bounded so we never overstay
 * Railway's grace window — a slow cleanup is worse than an abrupt exit.
 */

const CLEANUP_TIMEOUT_MS = 2500;
const FLUSH_TIMEOUT_MS = 2000;

let shuttingDown = false;

function withTimeout(promise: Promise<unknown>, ms: number): Promise<unknown> {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
}

export interface GracefulShutdownDeps {
  process?: NodeJS.Process;
  /** Injectable for tests; defaults to the real cron stopper. */
  stopCron?: () => void;
  /** Injectable for tests; defaults to the real lock release. */
  releaseLock?: (reason: string) => Promise<boolean>;
}

export function installGracefulShutdown(deps: GracefulShutdownDeps = {}): void {
  const proc = deps.process ?? process;
  const stopCron = deps.stopCron ?? stopCronJobs;
  const releaseLock = deps.releaseLock ?? releaseLocalProcessingLock;

  const handle = (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return Promise.resolve();
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received — stopping cron and releasing turn lock`);

    return (async () => {
      try {
        stopCron();
      } catch (err) {
        logger.error("shutdown", "stopCronJobs failed", err);
      }

      try {
        await withTimeout(releaseLock(signal), CLEANUP_TIMEOUT_MS);
      } catch (err) {
        logger.error("shutdown", "processing-lock release failed", err);
      }

      try {
        await Sentry.flush(FLUSH_TIMEOUT_MS);
      } catch {
        // Never let the Sentry flush hang the exit.
      }

      proc.exit(0);
    })();
  };

  proc.once("SIGTERM", () => handle("SIGTERM"));
  proc.once("SIGINT", () => handle("SIGINT"));
}
