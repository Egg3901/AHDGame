/**
 * The turn worker: the game's schedule, in a process that web deploys do not restart.
 *
 * Turns run in-process inside the Next.js server, driven by `instrumentation.ts` ->
 * `initializeCronJobs()`. Railway replaces the container on every web deploy, and a
 * SIGTERM mid-turn kills whatever turn is running. On 2026-09-06 four deploys inside
 * fifty minutes killed turn 673 partway through and cost the world that slot; nothing
 * in Railway is turn-aware, so nothing prevents it.
 *
 * Running the schedule here instead means a web deploy cannot touch a turn at all. It
 * is the only one of the four mitigations that makes that statement true rather than
 * cheaper: the crash-recovery and resume work reduce what an interrupted turn costs,
 * this removes the interruption.
 *
 * DEPLOY SHAPE
 *
 * A second Railway service off the same repo and the same MONGODB_URI, started with:
 *
 *     CRON_OWNER=worker npx tsx scripts/turn-worker.ts
 *
 * and the WEB service given `CRON_OWNER=worker` as well, which is what makes
 * `shouldRunCronInWebProcess` return false there. Deploy the worker rarely; deploy web
 * as often as you like.
 *
 * The switch is opt-OUT for web on purpose. If this worker is misconfigured and never
 * starts, an unset variable leaves web running turns exactly as it does today, rather
 * than leaving a world with no turns at all.
 *
 * ONE OWNER AT A TIME is not enforced here and does not need to be: `processTurn`
 * takes the `gameState` processing lock before doing anything, so a window where both
 * web and worker have cron running is safe. The second one to fire logs "Skipping,
 * another turn is already processing" and returns. That is what makes the cutover
 * boring: set the variable on the worker first, confirm it is taking turns, then set
 * it on web.
 */
import { initializeCronJobs, stopCronJobs } from "@/lib/cron";
import { releaseLocalProcessingLock } from "@/lib/turnSystem";
import { isCronWorkerProcess } from "@/lib/startupMode";

const SHUTDOWN_TIMEOUT_MS = 2500;

async function main(): Promise<void> {
  if (!isCronWorkerProcess(process.env)) {
    console.error(
      "[turn-worker] refusing to start without CRON_OWNER=worker. Web decides whether to " +
        "run its own cron by reading the same variable, so starting without it would give " +
        "the world two schedulers and no record of which is which."
    );
    process.exit(1);
  }

  console.log("[turn-worker] starting; this process owns the cron schedule");
  await initializeCronJobs();
  console.log("[turn-worker] cron initialized, waiting for the clock");

  const shutdown = async (signal: NodeJS.Signals) => {
    console.log(`[turn-worker] ${signal} received, stopping cron and releasing any turn lock`);
    try {
      stopCronJobs();
    } catch (err) {
      console.error("[turn-worker] stopCronJobs failed:", err);
    }
    try {
      // Same release the web server performs: it marks an interrupted turn abandoned
      // rather than clearing it, so the next tick resumes instead of re-running and
      // double-applying. See releaseLocalProcessingLock.
      await Promise.race([
        releaseLocalProcessingLock(signal),
        new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
      ]);
    } catch (err) {
      console.error("[turn-worker] lock release failed:", err);
    }
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // node-cron holds the loop open; this keeps intent explicit for a reader.
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error("[turn-worker] fatal:", err);
  process.exit(1);
});
