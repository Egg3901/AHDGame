import * as cron from "node-cron";
import * as Sentry from "@sentry/nextjs";
import { generateStockExchangeSnapshots } from "@/lib/turn/stockExchangeSnapshot";
import { applyPriceMultipliers } from "@/lib/corporations/applyPriceMultipliers";
import { updateCampaignFogOfWar } from "@/lib/campaigns/fogOfWar";
import { processTurn, getGameState, initializeGameState } from "./turnSystem";
import { shouldFireBackupTurn } from "./cron/backupFireGuard";
import { getProcessingLockState, TURN_LOCK_STALE_MS } from "./turn/processingLock";
import { recordTurnHeapDelta } from "@/lib/observability/heapWatchdog";
import { getDb } from "@/lib/mongodb";
import { deploymentServiceSlug } from "@/lib/deploymentIdentity";
import { sweepPlayerRandomEventsRealtime } from "@/lib/events/pree/driver";
import { persistApiAbuseScan } from "@/lib/api/abuseDetection";
import { runRetention } from "@/lib/retention/retention";
import { runAltScoring } from "@/lib/altDetection/run";
import { runAltDigest } from "@/lib/altDetection/digest";

/*
 * Sentry cron-monitor slug for the primary turn cron. Service-suffixed so
 * each Railway service (Sandbox Staging, Main Site) alerts on its own
 * monitor — `RAILWAY_ENVIRONMENT_NAME` alone is "production" on every
 * service in this project, which would collapse all deployments onto a
 * single shared monitor. When the Node process dies or instrumentation.ts
 * fails to re-init cron after a restart, Sentry stops receiving check-ins
 * and the monitor's missed-check-in alert fires — the only signal we have,
 * since an in-process detector dies with the process.
 *
 * Monitor config: hourly schedule covers both fast (every 30 min, sends
 * extras) and normal (every hour) modes. A missed check-in within
 * `checkinMargin` is tolerated; beyond that Sentry alerts.
 */
export function deriveTurnCronMonitorSlug(env: NodeJS.ProcessEnv = process.env): string {
  return `turn-cron-${deploymentServiceSlug(env)}`;
}
const TURN_CRON_MONITOR_SLUG = deriveTurnCronMonitorSlug();
const TURN_CRON_MONITOR_CONFIG = {
  schedule: { type: "crontab" as const, value: "0 * * * *" },
  checkinMargin: 5,
  maxRuntime: 5,
  timezone: "UTC",
};

/**
 * Wraps a processTurn() call with before/after heap sampling. Logs the delta
 * to stdout (for Railway log timeline) and feeds the watchdog's ring buffer
 * so trip events include the recent per-turn growth pattern.
 */
async function runTurnWithHeapDiagnostics(
  source: "primary" | "backup" | "stuckLockSweep"
): Promise<ReturnType<typeof processTurn>> {
  const before = process.memoryUsage();
  const t0 = Date.now();
  const result = await processTurn();
  const after = process.memoryUsage();
  const durationMs = Date.now() - t0;
  const deltaBytes = after.heapUsed - before.heapUsed;
  recordTurnHeapDelta({
    turn: result.turn,
    beforeBytes: before.heapUsed,
    afterBytes: after.heapUsed,
    durationMs,
  });
  console.log(
    `[Heap] turn ${result.turn} (${source}): heapUsed ${(before.heapUsed / 1_000_000).toFixed(0)}MB → ${(after.heapUsed / 1_000_000).toFixed(0)}MB (delta=${deltaBytes >= 0 ? "+" : ""}${(deltaBytes / 1_000_000).toFixed(1)}MB) rss=${(after.rss / 1_000_000).toFixed(0)}MB dur=${durationMs}ms`
  );
  return result;
}

let cronJob: ReturnType<typeof cron.schedule> | null = null;
let stockExchangeRefreshCron: ReturnType<typeof cron.schedule> | null = null;
let fogOfWarCron: ReturnType<typeof cron.schedule> | null = null;
let backupCron: ReturnType<typeof cron.schedule> | null = null;
let stuckLockRecoveryCron: ReturnType<typeof cron.schedule> | null = null;

/**
 * How long a turn lock must sit untouched before the 5-minute recovery sweep
 * will repossess it. Two full stale windows, i.e. twice what the :00/:30 turn
 * crons require — see the rationale at the sweep itself (#1208).
 */
const STUCK_LOCK_SWEEP_MIN_AGE_MS = 2 * TURN_LOCK_STALE_MS;
let playerEventsSweepCron: ReturnType<typeof cron.schedule> | null = null;
let apiAbuseScanCron: ReturnType<typeof cron.schedule> | null = null;
let retentionCron: ReturnType<typeof cron.schedule> | null = null;
let altScoringCron: ReturnType<typeof cron.schedule> | null = null;
let altDigestCron: ReturnType<typeof cron.schedule> | null = null;

/**
 * Get the cron schedule expression based on game state fastMode setting.
 * - Normal mode: "0 * * * *" (top of every hour)
 * - Fast mode: "0,30 * * * *" (every 30 minutes)
 */
function getCronSchedule(fastMode?: boolean): string {
  return fastMode ? "0,30 * * * *" : "0 * * * *";
}

/**
 * Initialize and start the cron job for turn processing
 * Runs at the top of every hour by default, or every 30 minutes if fastMode is enabled
 */
export async function initializeCronJobs() {
  // Ensure game state exists
  await initializeGameState();

  // Stop existing cron jobs if any
  if (cronJob) {
    cronJob.stop();
  }
  if (stockExchangeRefreshCron) {
    stockExchangeRefreshCron.stop();
  }
  if (fogOfWarCron) {
    fogOfWarCron.stop();
  }
  if (backupCron) {
    backupCron.stop();
  }
  if (stuckLockRecoveryCron) {
    stuckLockRecoveryCron.stop();
  }
  if (playerEventsSweepCron) {
    playerEventsSweepCron.stop();
  }

  // Get current game state to determine schedule
  const gameState = await getGameState();
  const schedule = getCronSchedule(gameState?.fastMode);
  const scheduleDescription = gameState?.fastMode ? "every 30 minutes" : "the top of every hour";

  // Create cron job with dynamic schedule based on fastMode
  cronJob = cron.schedule(
    schedule,
    async () => {
      // Tick-fired log is outside Sentry.withMonitor on purpose: it proves the
      // node-cron scheduler ran the callback at the expected time. When the
      // Sentry monitor goes silent (missed check-ins) while the container is
      // alive, the presence/absence of this log distinguishes a scheduler
      // problem from a withMonitor problem (withMonitor hang or throw is the
      // current leading hypothesis for the 2026-05-25 ~3h cron silence).
      const tickStartedAt = Date.now();
      console.log(`[Cron] tick fired at ${new Date(tickStartedAt).toISOString()}`);
      try {
        // Wrap the entire callback in Sentry.withMonitor so a check-in fires
        // on every cron tick — even paused / locked turns. The external
        // monitor alert is our only signal when the in-process scheduler dies
        // (see slug comment).
        await Sentry.withMonitor(
          TURN_CRON_MONITOR_SLUG,
          async () => {
            const currentState = await getGameState();
            const modeLabel = currentState?.fastMode ? "[Fast Mode]" : "[Cron]";
            console.log(`${modeLabel} Turn check triggered at`, new Date().toISOString());

            try {
              if (!currentState) {
                console.log("[Cron] Game state not found, skipping turn");
                return;
              }

              if (!currentState.isActive) {
                console.log("[Cron] Turn system is not active, skipping turn");
                return;
              }

              if (currentState.isProcessing) {
                // If the heartbeat is fresh, a real turn is in progress — skip.
                // If it's stale (or missing while updatedAt is old), the previous
                // process likely died mid-turn; fall through so processTurn's
                // findOneAndUpdate-based stale-lock takeover can repossess the
                // lock. Otherwise the cron would skip forever on a permanently
                // stuck isProcessing flag (2026-05-24 sandbox-staging incident).
                const lockState = getProcessingLockState(currentState);
                if (!lockState.isStale) {
                  console.log("[Cron] Turn processing skipped — turn already in progress");
                  return;
                }
                console.warn(
                  `[Cron] Stale processing lock detected (lastTouch=${
                    lockState.lastTouch?.toISOString() ?? "none"
                  }); allowing processTurn to take over.`
                );
              }

              // Process the turn
              const result = await runTurnWithHeapDiagnostics("primary");
              console.log("[Cron] Turn processing result:", result);
            } catch (error) {
              console.error("[Cron] Error in turn processing:", error);
              Sentry.captureException(error, {
                tags: { component: "cron", job: "turn" },
              });
            }
          },
          TURN_CRON_MONITOR_CONFIG
        );
        console.log(`[Cron] tick completed in ${Date.now() - tickStartedAt}ms`);
      } catch (err) {
        // If Sentry.withMonitor itself throws, swallow the rejection so the
        // node-cron callback resolves cleanly — an unhandledRejection here
        // would route through crashCapture and exit the process, breaking
        // the next tick. The log line preserves the timing for diagnosis.
        console.error(
          `[Cron] tick failed after ${Date.now() - tickStartedAt}ms (withMonitor threw):`,
          err
        );
        // Also surface to Sentry so visibility doesn't regress vs. the
        // previous behavior where unhandledRejection routed through
        // crashCapture (which captured + exited). We keep the process alive
        // so subsequent ticks can fire; the Sentry event keeps the alerting.
        try {
          Sentry.captureException(err, {
            tags: { component: "turnCron", op: "withMonitor" },
          });
        } catch {
          // Sentry SDK could itself be the failure mode — never let the
          // capture call re-throw and bring down the cron callback.
        }
      }
    },
    {
      // UTC so DST transitions don't skip (spring-forward) or duplicate
      // (fall-back) cron fires. The game-clock advances 1 turn per cron fire,
      // so a TZ that shifts off DST would cause the game clock to drift by
      // ~1h twice a year. UTC is DST-immune.
      timezone: "UTC",
    }
  );

  // Backup turn at :30 — only fires if primary (:00) missed
  backupCron = cron.schedule(
    "30 * * * *",
    async () => {
      try {
        const currentState = await getGameState();
        if (!currentState?.isActive) return;
        if (currentState.fastMode) return; // fastMode handles :30 via main cron

        if (currentState.isProcessing) {
          // Same stuck-lock recovery as primary cron: a stale lock means the
          // prior turn died mid-process; fall through so processTurn's
          // takeover can recover. Otherwise the backup path is also dead.
          const lockState = getProcessingLockState(currentState);
          if (!lockState.isStale) {
            console.log("[Cron] Backup turn skipped — turn already in progress");
            return;
          }
          console.warn(
            `[Cron] Stale processing lock detected on backup tick (lastTouch=${
              lockState.lastTouch?.toISOString() ?? "none"
            }); allowing processTurn to take over.`
          );
        }

        const shouldFire = await shouldFireBackupTurn(new Date(), currentState);
        if (!shouldFire) {
          console.log("[Cron] Backup turn skipped — primary already processed this hour");
          return;
        }

        // Same processTurn logic as primary
        const result = await runTurnWithHeapDiagnostics("backup");
        console.log("[Cron] Backup turn processed:", result);
      } catch (error) {
        console.error("[Cron] Error in backup turn processing:", error);
        Sentry.captureException(error, { tags: { component: "cron", job: "backupTurn" } });
      }
    },
    { timezone: "UTC" }
  );

  // Stuck-lock recovery sweep. STRICTLY a recovery path: it never starts a
  // turn that is merely due, only repossesses one whose lock has gone stale.
  //
  // Why this exists (2026-08-28): when a process dies mid-turn — a redeploy's
  // SIGTERM, a heapWatchdog trip, or a hard V8 OOM — gameState.isProcessing is
  // left set with a frozen heartbeat. Recovery previously depended on the turn
  // cron's own ticks, which are only :00 and :30, so a turn killed at :05 sat
  // wedged on "Processing..." until :30, and one killed at :35 until the next
  // :30 — most of an hour. Sweeping every 5 minutes bounds the wedge to roughly
  // the stale window plus 5 minutes.
  //
  // TURN_LOCK_STALE_MS (20 min) is deliberately NOT shortened to speed this up:
  // it is the safety interlock that stops a second process stealing the lock
  // from a turn that is alive but not heart-beating (a long synchronous stretch
  // starves the 30s heartbeat timer). Observed turns have run 666s and 495s.
  stuckLockRecoveryCron = cron.schedule(
    "*/5 * * * *",
    async () => {
      try {
        const currentState = await getGameState();
        if (!currentState?.isActive) return;
        // Nothing held → nothing to recover. Never fall through to processTurn
        // here; starting a turn is the :00 / :30 crons' job, not this sweep's.
        if (!currentState.isProcessing) return;

        // Only ever repossess a TURN lock. gameState's processing lock is shared
        // with other long operations — the forex migration takes it as
        // processingKind "forexMigration" — and processTurn's own crash-recovery
        // guard (shouldRecoverCrashedTurn) bails on a non-turn kind, which means
        // it would fall through and run a NORMAL turn instead. Since this sweep
        // fires on every 5-minute boundary rather than only at :00/:30, that
        // would advance the game clock at an arbitrary time off the hour.
        // Clearing a stranded migration lock is the admin Reset Lock's job, not
        // this sweep's: taking it over could corrupt a half-applied migration.
        if (currentState.processingKind !== "turn") return;

        const lockState = getProcessingLockState(currentState);
        if (!lockState.isStale) return;

        // Deliberately MORE conservative than the :00/:30 crons, which act as
        // soon as the lock is stale at TURN_LOCK_STALE_MS.
        //
        // #1208 is a real production incident of the hazard: a turn that ran
        // past the 20-minute threshold WITHOUT heartbeating was taken over by a
        // second worker while still alive, re-running news-emitting phases and
        // posting duplicate World News. The dedup added there is explicitly
        // best-effort, so it mitigates the symptom rather than the race.
        //
        // This sweep checks every 5 minutes instead of every 30, so it is far
        // likelier than those crons to catch a turn in the window where it is
        // merely blocked (a long synchronous stretch starves the 30s heartbeat
        // timer) rather than dead. A dead holder never heartbeats again, so
        // waiting a second full window costs it nothing; a blocked one gets
        // that much longer to recover and keep its lock. Worst-case wedge is
        // still bounded well under the up-to-an-hour this sweep exists to fix.
        const lastTouchMs = lockState.lastTouch?.getTime();
        const lockAgeMs = lastTouchMs === undefined ? Infinity : Date.now() - lastTouchMs;
        if (lockAgeMs < STUCK_LOCK_SWEEP_MIN_AGE_MS) return;

        console.warn(
          `[Cron] Stuck-lock sweep: stale processing lock (lastTouch=${
            lockState.lastTouch?.toISOString() ?? "none"
          }, phase=${currentState.processingPhase ?? "none"}, targetTurn=${
            currentState.processingTargetTurn ?? "none"
          }); allowing processTurn to take over.`
        );
        // Telemetry must never gate recovery: if the Sentry SDK is itself the
        // failure mode, a throw here would skip the takeover below and leave
        // the game wedged — the exact outcome this sweep exists to prevent.
        try {
          Sentry.captureMessage("Stuck turn lock recovered by sweep", {
            level: "warning",
            fingerprint: ["stuck-turn-lock-sweep"],
            extra: {
              lastTouch: lockState.lastTouch?.toISOString() ?? null,
              processingPhase: currentState.processingPhase ?? null,
              processingTargetTurn: currentState.processingTargetTurn ?? null,
            },
          });
        } catch {
          // Deliberately swallowed — see above.
        }

        const result = await runTurnWithHeapDiagnostics("stuckLockSweep");
        console.log("[Cron] Stuck-lock sweep result:", result);
      } catch (error) {
        console.error("[Cron] Error in stuck-lock recovery sweep:", error);
        Sentry.captureException(error, {
          tags: { component: "cron", job: "stuckLockSweep" },
        });
      }
    },
    { timezone: "UTC" }
  );

  stockExchangeRefreshCron = cron.schedule(
    "*/15 * * * *",
    async () => {
      try {
        const currentState = await getGameState();
        if (!currentState?.isActive) return;
        if (currentState.isProcessing) {
          // Stale lock = no real turn in flight (prior process died mid-turn).
          // Refresh prices anyway; processTurn's own findOneAndUpdate keeps
          // takeover safe if a turn-cron tick happens to arrive concurrently.
          // Observed 2026-05-24: this cron skipped for hours on a stuck flag.
          const lockState = getProcessingLockState(currentState);
          if (!lockState.isStale) {
            console.log("[Cron] Stock exchange refresh skipped — turn in progress");
            return;
          }
          console.warn(
            `[Cron] Stale processing lock detected on stock tick (lastTouch=${
              lockState.lastTouch?.toISOString() ?? "none"
            }); proceeding with refresh.`
          );
        }
        const { updated, pulseCount } = await applyPriceMultipliers();
        await generateStockExchangeSnapshots(currentState.currentTurn);
        console.log("[Cron] Stock exchange refreshed at", new Date().toISOString(), {
          pricesUpdated: updated,
          pulseCount,
        });
      } catch (error) {
        console.error("[Cron] Stock exchange refresh failed:", error);
        Sentry.captureException(error, { tags: { component: "cron", job: "stockExchange" } });
      }
    },
    { timezone: "UTC" }
  );

  fogOfWarCron = cron.schedule(
    "0 * * * *",
    async () => {
      try {
        // Skip when the turn cron is paused (manual or auto-drift) — fog of
        // war advances against game-clock state, so we don't burn cycles
        // updating against a frozen game world.
        const currentState = await getGameState();
        if (!currentState?.isActive) {
          console.log("[Cron] Fog of war skipped — turn system inactive");
          return;
        }
        await updateCampaignFogOfWar();
        console.log("[Cron] Fog of war updated at", new Date().toISOString());
      } catch (error) {
        console.error("[Cron] Fog of war update failed:", error);
        Sentry.captureException(error, { tags: { component: "cron", job: "fogOfWar" } });
      }
    },
    { timezone: "UTC" }
  );

  playerEventsSweepCron = cron.schedule(
    "*/15 * * * *",
    async () => {
      try {
        const currentState = await getGameState();
        if (!currentState?.isActive) {
          return;
        }
        const db = await getDb();
        const swept = await sweepPlayerRandomEventsRealtime(db, currentState.currentTurn);
        if (swept > 0) {
          console.log("[Cron] Player random events swept:", swept);
        }
      } catch (error) {
        console.error("[Cron] Player random events sweep failed:", error);
        Sentry.captureException(error, { tags: { component: "cron", job: "playerEventsSweep" } });
      }
    },
    { timezone: "UTC" }
  );

  // API abuse detection is independent of the game clock — it scans request
  // telemetry, not game state — so it runs regardless of whether turns are active.
  apiAbuseScanCron = cron.schedule(
    "0 * * * *",
    async () => {
      try {
        const db = await getDb();
        const scan = await persistApiAbuseScan(db);
        if (scan.flaggedActors > 0) {
          console.log(`[Cron] API abuse scan flagged ${scan.flaggedActors} actor(s)`);
        }
      } catch (error) {
        console.error("[Cron] API abuse scan failed:", error);
        Sentry.captureException(error, { tags: { component: "cron", job: "apiAbuseScan" } });
      }
    },
    { timezone: "UTC" }
  );

  // Daily history-retention pass: archive old rows to R2 and delete/downsample.
  // Runs a real pass only when RETENTION_ENABLED=1; otherwise a harmless dry-run
  // so the manifest is logged without touching data.
  retentionCron = cron.schedule(
    "30 4 * * *",
    async () => {
      try {
        const enabled = process.env.RETENTION_ENABLED === "1";
        const summary = await runRetention({ dryRun: !enabled, compact: enabled });
        const totalDeleted = summary.results.reduce((s, r) => s + (r.deletedCount ?? 0), 0);
        const totalArchived = summary.results.reduce((s, r) => s + (r.archivedCount ?? 0), 0);
        console.log(
          `[Cron] Retention ${enabled ? "pass" : "dry-run"} @turn ${summary.currentTurn}: ` +
            `archived ${totalArchived}, deleted ${totalDeleted}`
        );
      } catch (error) {
        console.error("[Cron] Retention pass failed:", error);
        Sentry.captureException(error, { tags: { component: "cron", job: "retention" } });
      }
    },
    { timezone: "UTC" }
  );

  // Alt-detection compute pass (forensics/alt-detection rework plan §3.2,
  // Phase 6 T6.1). Deliberately an HOURLY CRON, not a turn phase — an owner
  // decision to keep this off the turn loop (plan §7 open question 3).
  // Independent of the game clock (like the API abuse scan above): alt
  // evidence (shared devices/IPs/funding/wire patterns) stays meaningful
  // even while turns are paused, so this runs regardless of
  // `gameState.isActive`. `runAltScoring` is itself gated on
  // `isAltScoringEnabled()` and never throws — it's a cheap no-op read of
  // one gameConfig doc when the flag is off.
  altScoringCron = cron.schedule(
    "45 * * * *",
    async () => {
      try {
        const db = await getDb();
        const result = await runAltScoring(db);
        if (result.enabled) {
          console.log(
            `[Cron] Alt scoring: ${result.candidateCount} candidate(s), ` +
              `${result.linksWritten}/${result.linksComputed} link(s) written, ` +
              `${result.clustersWritten}/${result.clustersComputed} cluster(s) written ` +
              `(${result.clustersOpened} newly opened) in ${result.durationMs}ms`
          );
        }
        if (result.error) {
          console.error("[Cron] Alt scoring pass reported an error:", result.error);
        }
      } catch (error) {
        // Belt-and-suspenders — runAltScoring already catches internally,
        // but a cron callback throwing would still be worth capturing.
        console.error("[Cron] Alt scoring pass failed:", error);
        Sentry.captureException(error, { tags: { component: "cron", job: "altScoring" } });
      }
    },
    { timezone: "UTC" }
  );

  // Daily "new suspicious rings" digest (forensics-v2 Wave 2, scale/learning
  // §C). Staggered well clear of the hourly alt-scoring pass (:45) and the
  // retention pass (04:30) so it always summarizes a fully-recomputed
  // `altClusters` snapshot. Independent of the game clock, same rationale as
  // `altScoringCron` above. `runAltDigest` is itself gated on
  // `isAltScoringEnabled()` and never throws — a cheap no-op when the flag
  // is off or there's nothing new to report.
  altDigestCron = cron.schedule(
    "0 13 * * *",
    async () => {
      try {
        const db = await getDb();
        const result = await runAltDigest(db);
        if (result.enabled && result.newClusterCount > 0) {
          console.log(
            `[Cron] Alt digest: ${result.newClusterCount} new ring(s) found, ` +
              `${result.reportedInBody} shown in body, posted=${result.posted} ` +
              `(webhookConfigured=${result.webhookConfigured}) in ${result.durationMs}ms`
          );
        }
        if (result.error) {
          console.error("[Cron] Alt digest pass reported an error:", result.error);
        }
      } catch (error) {
        // Belt-and-suspenders — runAltDigest already catches internally,
        // but a cron callback throwing would still be worth capturing.
        console.error("[Cron] Alt digest pass failed:", error);
        Sentry.captureException(error, { tags: { component: "cron", job: "altDigest" } });
      }
    },
    { timezone: "UTC" }
  );

  console.log(`[Cron] Cron jobs initialized. Turn processing will run at ${scheduleDescription}.`);
  console.log("[Cron] Stock exchange (prices + snapshots) will refresh every 15 minutes.");
  console.log("[Cron] Fog of war will update every hour.");
  console.log("[Cron] Player random events will sweep every 15 minutes.");
  console.log("[Cron] API abuse detection will scan every hour.");
  console.log(
    `[Cron] History retention will run daily at 04:30 UTC (${
      process.env.RETENTION_ENABLED === "1" ? "live" : "dry-run"
    }).`
  );
  console.log("[Cron] Stuck turn-lock recovery sweep will run every 5 minutes.");
  console.log("[Cron] Alt-detection scoring will run every hour at :45 (flag-gated).");
  console.log("[Cron] Alt digest (new suspicious rings) will run daily at 13:00 UTC (flag-gated).");
}

/**
 * Restart the cron job with a new schedule (e.g., when toggling fastMode)
 */
export async function restartCronWithSchedule() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
  if (stockExchangeRefreshCron) {
    stockExchangeRefreshCron.stop();
    stockExchangeRefreshCron = null;
  }
  if (backupCron) {
    backupCron.stop();
    backupCron = null;
  }
  if (stuckLockRecoveryCron) {
    stuckLockRecoveryCron.stop();
    stuckLockRecoveryCron = null;
  }
  if (playerEventsSweepCron) {
    playerEventsSweepCron.stop();
    playerEventsSweepCron = null;
  }
  if (apiAbuseScanCron) {
    apiAbuseScanCron.stop();
    apiAbuseScanCron = null;
  }
  if (retentionCron) {
    retentionCron.stop();
    retentionCron = null;
  }
  if (altScoringCron) {
    altScoringCron.stop();
    altScoringCron = null;
  }
  if (altDigestCron) {
    altDigestCron.stop();
    altDigestCron = null;
  }
  await initializeCronJobs();
}

/**
 * Stop the cron job
 */
export function stopCronJobs() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
  }
  if (stockExchangeRefreshCron) {
    stockExchangeRefreshCron.stop();
    stockExchangeRefreshCron = null;
  }
  if (fogOfWarCron) {
    fogOfWarCron.stop();
    fogOfWarCron = null;
  }
  if (backupCron) {
    backupCron.stop();
    backupCron = null;
  }
  if (stuckLockRecoveryCron) {
    stuckLockRecoveryCron.stop();
    stuckLockRecoveryCron = null;
  }
  if (playerEventsSweepCron) {
    playerEventsSweepCron.stop();
    playerEventsSweepCron = null;
  }
  if (apiAbuseScanCron) {
    apiAbuseScanCron.stop();
    apiAbuseScanCron = null;
  }
  if (retentionCron) {
    retentionCron.stop();
    retentionCron = null;
  }
  if (altScoringCron) {
    altScoringCron.stop();
    altScoringCron = null;
  }
  if (altDigestCron) {
    altDigestCron.stop();
    altDigestCron = null;
  }
  console.log("[Cron] Cron jobs stopped");
}

/**
 * Get cron job status
 */
export function getCronStatus(): { running: boolean } {
  return {
    running: cronJob !== null,
  };
}
