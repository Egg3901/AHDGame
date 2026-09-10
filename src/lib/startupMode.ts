export function shouldStartHostedBackgroundServices(
  env: Record<string, string | undefined>
): boolean {
  return env.DISABLE_DEV_BACKGROUND !== "1" && env.SINGLEPLAYER !== "1";
}

/**
 * Should THIS process own the cron schedule, turn processing included?
 *
 * Turns run in-process inside the Next.js server, driven by `instrumentation.ts` ->
 * `cron.ts`. That means every WEB deploy sends SIGTERM to whatever turn happens to be
 * running: on 2026-09-06 four deploys inside fifty minutes killed turn 673 partway and
 * cost the slot. Nothing in Railway is turn-aware, so nothing prevents it.
 *
 * The durable answer is to run the schedule in its own service that web deploys do not
 * touch. This is the switch for that split:
 *
 *   - unset            web owns cron, exactly as today. THE DEFAULT, so nothing changes
 *                      until the worker service actually exists.
 *   - CRON_OWNER=worker   web starts no cron; the worker process (scripts/turn-worker.ts)
 *                      owns the whole schedule.
 *
 * Deliberately opt-OUT for web rather than opt-in. A misconfigured worker that never
 * starts must not silently leave a world with no turns at all, so the failure mode of
 * a missing variable is "web keeps running turns", not "nobody does".
 */
export function shouldRunCronInWebProcess(env: Record<string, string | undefined>): boolean {
  return shouldStartHostedBackgroundServices(env) && env.CRON_OWNER !== "worker";
}

/** Is this process the dedicated cron worker? Only `scripts/turn-worker.ts` sets it. */
export function isCronWorkerProcess(env: Record<string, string | undefined>): boolean {
  return env.CRON_OWNER === "worker";
}
