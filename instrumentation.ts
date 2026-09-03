import * as Sentry from "@sentry/nextjs";

/**
 * Log a heap+rss snapshot under [boot] so we can correlate boot-time
 * allocation against each init step. Helps identify which import/init
 * is responsible for the ~200MB baseline heap we measured pre-watchdog.
 */
function logBootHeap(step: string): void {
  // Access via globalThis so Turbopack's edge bundling doesn't statically bind
  // `process.memoryUsage` (absent from the edge `process` polyfill, which trips
  // the Sentry valueInjectionLoader transform). Guarded for absence at runtime;
  // this only ever runs in the nodejs branch where memoryUsage exists.
  const memoryUsage = globalThis.process?.memoryUsage;
  if (typeof memoryUsage !== "function") return;
  const mem = memoryUsage();
  console.log(
    `[boot] ${step}: heapUsed=${(mem.heapUsed / 1_000_000).toFixed(0)}MB heapTotal=${(mem.heapTotal / 1_000_000).toFixed(0)}MB rss=${(mem.rss / 1_000_000).toFixed(0)}MB external=${(mem.external / 1_000_000).toFixed(0)}MB`
  );
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    logBootHeap("register() entry");
    await import("./sentry.server.config");
    logBootHeap("after sentry.server.config");

    // Install process-level crash capture BEFORE anything else can throw at
    // boot, so unhandledRejection / uncaughtException in subsequent init
    // (seed, cron) is captured to Sentry instead of dying silently.
    const { installCrashCapture } = await import("@/lib/observability/crashCapture");
    installCrashCapture();
    logBootHeap("after installCrashCapture");

    // Pre-OOM heap watchdog. Catches both V8-OOM-bound heap growth AND the
    // Railway-SIGKILL pattern where RSS spikes past the container cap with
    // heap still under the heap-only threshold (2026-05-25 incidents).
    // Defaults: heap 75% / RSS 70% of cap — see heapWatchdog.ts. Checks every
    // 10s for responsiveness; logs a sample once per minute to keep Railway
    // log volume sane. Exits cleanly with a Sentry event so we always get
    // telemetry before Railway sends OOM/SIGKILL.
    //
    // PRODUCTION ONLY. The watchdog's rssCapBytes default (5GB) is sized for
    // Railway's container cap; in `next dev` Turbopack/SWC holds multi-GB of
    // compile-time memory in native RSS (not JS heap), which trips the RSS
    // threshold ~40s into boot — a false positive that kills the dev server.
    if (process.env.NODE_ENV === "production") {
      const { startHeapWatchdog } = await import("@/lib/observability/heapWatchdog");
      startHeapWatchdog({
        // Railway container limit (5GB after the 2026-05-25 bump). Override per
        // service via env if other deployments use a different cap.
        rssCapBytes: Number(process.env.HEAP_WATCHDOG_RSS_CAP_BYTES) || 5_000_000_000,
      });
      logBootHeap("after startHeapWatchdog");
    }

    // TEMPORARY (local dev, do not commit): gate auto-seed + cron behind
    // DISABLE_DEV_BACKGROUND so a local `next dev` doesn't run a second turn
    // scheduler / seeder against the configured DB while inspecting the UI.
    const devBackgroundDisabled = process.env.DISABLE_DEV_BACKGROUND === "1";
    if (devBackgroundDisabled) {
      console.log("[dev] DISABLE_DEV_BACKGROUND=1 — skipping auto-seed and cron init");
    }

    // Auto-seed on startup if the database is empty
    if (!devBackgroundDisabled)
      try {
        const { getDb } = await import("@/lib/mongodb");
        logBootHeap("after mongodb import");
        const { runSeed } = await import("@/lib/admin/seed/runCoreSeed");
        // Imported dynamically, inside the nodejs guard, for the same reason as
        // everything else here: this module reaches `mongodb`, and a static
        // top-level import pulls it into the EDGE instrumentation bundle too.
        // Next emits an `__import_unsupported` shim rather than failing the
        // build, so the damage only shows at runtime — every request logs
        // `ReferenceError: __import_unsupported is not defined`, the healthcheck
        // fails, and the container is SIGTERMed. Build stays green throughout.
        const { getGameStatePresetOrDefault } = await import("@/lib/db/collections/gameState");
        const db = await getDb();
        logBootHeap("after getDb (mongo connection ready)");
        const result = await runSeed({ db, preset: await getGameStatePresetOrDefault(db) });
        if (result.seeded) {
          console.log("[auto-seed]", result.message);
        }
        logBootHeap("after runSeed");
      } catch (err) {
        console.warn("[auto-seed] skipped:", err instanceof Error ? err.message : err);
      }

    // Apply the small audited set of data repairs that must ship atomically
    // with their runtime code. This is deliberately separate from auto-seed:
    // an already-populated world returns early from runSeed, and a seed error
    // must not silently prevent a required repair. The full migration registry
    // remains an explicit operator action (`npm run migrate`).
    if (!devBackgroundDisabled) {
      try {
        const { getDb } = await import("@/lib/mongodb");
        const { runRequiredStartupMigrations } = await import("@/lib/migrations/startupMigrations");
        const summary = await runRequiredStartupMigrations(await getDb());
        console.log(
          `[startup-migrations] ran=${summary.ranIds.join(",") || "none"} ` +
            `skipped=${summary.skippedIds.join(",") || "none"}`
        );
        for (const id of summary.ranIds) {
          for (const note of summary.results[id]?.notes ?? []) {
            console.log(`[startup-migrations] ${id}: ${note}`);
          }
        }
        logBootHeap("after required startup migrations");
      } catch (err) {
        console.error(
          "[startup-migrations] failed:",
          err instanceof Error ? (err.stack ?? err.message) : err
        );
        // A required repair failing is not a healthy deployment. Refuse to
        // start cron and serve a world with a known inconsistent market.
        throw err;
      }
    }

    // Check transaction support at boot
    try {
      const { assertTransactionSupportAtBoot } = await import("@/lib/db/transactionSupport");
      await assertTransactionSupportAtBoot();
      logBootHeap("after transaction-support check");
    } catch (err) {
      console.warn(
        "[db] transaction-support check failed:",
        err instanceof Error ? err.message : err
      );
    }

    // Start in-process cron jobs (turn processing, stock exchange, fog of war).
    // Railway runs a persistent server — node-cron is the correct scheduler here.
    // Vercel crons (vercel.json) are not executed on Railway.
    if (!devBackgroundDisabled)
      try {
        const { initializeCronJobs } = await import("@/lib/cron");
        logBootHeap("after cron module import");
        await initializeCronJobs();
        logBootHeap("after initializeCronJobs");
      } catch (err) {
        console.error(
          "[cron] Failed to initialize cron jobs:",
          err instanceof Error ? err.message : err
        );
      }

    // Release the turn lock on SIGTERM/SIGINT (Railway redeploys) so a redeploy
    // mid-turn recovers instantly instead of stranding the lock until the
    // 20-min stale takeover. Installed after cron so shutdown can stop it.
    try {
      const { installGracefulShutdown } = await import("@/lib/turn/shutdownHandler");
      installGracefulShutdown();
      logBootHeap("after installGracefulShutdown");
    } catch (err) {
      console.error(
        "[shutdown] Failed to install graceful shutdown handler:",
        err instanceof Error ? err.message : err
      );
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Automatically captures all unhandled server-side request errors
export const onRequestError = Sentry.captureRequestError;
