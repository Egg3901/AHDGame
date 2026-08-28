import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock node-cron
vi.mock("node-cron", () => ({
  default: {
    schedule: vi.fn(),
  },
  schedule: vi.fn(),
}));

// Mock turnSystem
vi.mock("./turnSystem", () => ({
  processTurn: vi.fn(),
  getGameState: vi.fn(),
  initializeGameState: vi.fn(),
}));

// Mock backupFireGuard
vi.mock("./cron/backupFireGuard", () => ({
  shouldFireBackupTurn: vi.fn(),
}));

// Mock @sentry/nextjs — withMonitor must forward to the wrapped fn so cron logic still runs.
vi.mock("@sentry/nextjs", () => ({
  withMonitor: vi.fn((_slug: string, fn: () => unknown | Promise<unknown>) => fn()),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

/** Cron expressions, so tests can select a callback by what it schedules
 * rather than by the order it happens to be registered in. */
const STOCK_EXCHANGE_SCHEDULE = "*/15 * * * *";
const STUCK_LOCK_SWEEP_SCHEDULE = "*/5 * * * *";

describe("cron jobs", () => {
  let mockSchedule: ReturnType<typeof vi.fn>;
  let mockProcessTurn: ReturnType<typeof vi.fn>;
  let mockGetGameState: ReturnType<typeof vi.fn>;
  let mockInitializeGameState: ReturnType<typeof vi.fn>;
  let mockShouldFireBackupTurn: ReturnType<typeof vi.fn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const cron = await import("node-cron");
    const turnSystem = await import("./turnSystem");
    const backupFireGuard = await import("./cron/backupFireGuard");
    mockSchedule = vi.mocked(cron.schedule);
    mockProcessTurn = vi.mocked(turnSystem.processTurn);
    mockGetGameState = vi.mocked(turnSystem.getGameState);
    mockInitializeGameState = vi.mocked(turnSystem.initializeGameState);
    mockShouldFireBackupTurn = vi.mocked(backupFireGuard.shouldFireBackupTurn);
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.clearAllMocks();
  });

  /** The callback registered for `expression`. Throws rather than returning
   * undefined so a renamed/removed schedule fails loudly instead of as an
   * inscrutable "callback is not a function". */
  function findScheduledCallback(expression: string): () => Promise<void> {
    const call = mockSchedule.mock.calls.find((args: unknown[]) => args[0] === expression);
    if (!call) {
      const registered = mockSchedule.mock.calls.map((args: unknown[]) => args[0]);
      throw new Error(
        `No cron scheduled for "${expression}". Registered: ${JSON.stringify(registered)}`
      );
    }
    return call[1] as () => Promise<void>;
  }

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.resetModules();
  });

  describe("initializeCronJobs", () => {
    it("initializes game state before scheduling cron", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        lastProcessed: new Date(),
      });
      mockSchedule.mockReturnValue({
        start: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      } as any);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();

      expect(mockInitializeGameState).toHaveBeenCalled();
      expect(mockSchedule).toHaveBeenCalled();
    });

    it("schedules cron job at the top of every hour", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        lastProcessed: new Date(),
      });
      const mockCronJob = {
        start: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      };
      mockSchedule.mockReturnValue(mockCronJob as any);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();

      expect(mockSchedule).toHaveBeenCalledWith(
        "0 * * * *", // At minute 0 of every hour
        expect.any(Function),
        {
          timezone: "UTC",
        }
      );
    });

    it("schedules backup cron job at :30 in normal mode", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        fastMode: false,
        lastProcessed: new Date(),
      });
      const mockCronJob = {
        start: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      };
      mockSchedule.mockReturnValue(mockCronJob as any);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();

      expect(mockSchedule).toHaveBeenCalledWith("30 * * * *", expect.any(Function), {
        timezone: "UTC",
      });
    });

    it("stops existing cron jobs before creating new ones", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        lastProcessed: new Date(),
      });
      const mockCronJob = {
        start: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      };
      mockSchedule.mockReturnValue(mockCronJob as any);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();
      await initializeCronJobs(); // Call twice to test stop logic

      // Six cron jobs: turn processing, backup turn, stuck turn-lock recovery
      // sweep, stock exchange refresh, fog of war, player random events sweep.
      // All share the same mocked handle, so stop() is called once per active job on re-init.
      expect(mockCronJob.stop).toHaveBeenCalledTimes(6);
    });

    it("logs initialization message", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        lastProcessed: new Date(),
      });
      mockSchedule.mockReturnValue({
        start: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      } as any);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Cron] Cron jobs initialized")
      );
    });
  });

  describe("primary turn cron callback", () => {
    it("skips turn when game state is not found", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue(null);
      const mockCronJob = {
        start: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      };
      mockSchedule.mockReturnValue(mockCronJob as any);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();

      // Get the callback function passed to schedule
      const callback = mockSchedule.mock.calls[0][1];
      await callback();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Cron] Game state not found")
      );
      expect(mockProcessTurn).not.toHaveBeenCalled();
    });

    it("skips turn when game state is not active", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: false,
        lastProcessed: new Date(),
      });
      const mockCronJob = {
        start: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      };
      mockSchedule.mockReturnValue(mockCronJob as any);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();

      const callback = mockSchedule.mock.calls[0][1];
      await callback();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Cron] Turn system is not active")
      );
      expect(mockProcessTurn).not.toHaveBeenCalled();
    });

    it("skips turn when a turn is already in progress with a fresh heartbeat", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        isProcessing: true,
        processingHeartbeatAt: new Date(),
        lastProcessed: new Date(),
      });
      const mockCronJob = {
        start: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      };
      mockSchedule.mockReturnValue(mockCronJob as any);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();

      const callback = mockSchedule.mock.calls[0][1];
      await callback();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Cron] Turn processing skipped — turn already in progress")
      );
      expect(mockProcessTurn).not.toHaveBeenCalled();
    });

    it("falls through to processTurn when isProcessing is true but the lock heartbeat is stale", async () => {
      // Regression: 2026-05-24 sandbox-staging cron silence. A container died
      // mid-turn leaving isProcessing=true in the DB. The restarted container's
      // cron fired on schedule but skipped every tick on the raw isProcessing
      // check, never giving processTurn's stale-lock takeover (findOneAndUpdate
      // with $or staleness clauses) a chance to recover. The callback must let
      // stale locks fall through so processTurn can repossess them.
      mockInitializeGameState.mockResolvedValue(undefined);
      const staleHeartbeat = new Date(Date.now() - 25 * 60 * 1000); // > TURN_LOCK_STALE_MS (20min)
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        isProcessing: true,
        processingHeartbeatAt: staleHeartbeat,
        lastProcessed: new Date(),
      });
      mockProcessTurn.mockResolvedValue({} as any);
      const mockCronJob = {
        start: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      };
      mockSchedule.mockReturnValue(mockCronJob as any);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();

      const callback = mockSchedule.mock.calls[0][1] as () => Promise<void>;
      await callback();

      expect(mockProcessTurn).toHaveBeenCalled();
    });

    it("falls through to processTurn when isProcessing is true but the lock has no heartbeat and updatedAt is stale", async () => {
      // Covers the legacy/pre-heartbeat crash case: container died before
      // writing its first heartbeat, leaving only the original updatedAt.
      // getProcessingLockState falls back to updatedAt, and if that's older
      // than TURN_LOCK_STALE_MS the lock must be eligible for takeover.
      mockInitializeGameState.mockResolvedValue(undefined);
      const staleUpdatedAt = new Date(Date.now() - 25 * 60 * 1000);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        isProcessing: true,
        updatedAt: staleUpdatedAt,
        lastProcessed: new Date(),
      });
      mockProcessTurn.mockResolvedValue({} as any);
      const mockCronJob = {
        start: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      };
      mockSchedule.mockReturnValue(mockCronJob as any);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();

      const callback = mockSchedule.mock.calls[0][1] as () => Promise<void>;
      await callback();

      expect(mockProcessTurn).toHaveBeenCalled();
    });

    it("logs a tick-fired line BEFORE entering Sentry.withMonitor", async () => {
      // Diagnostic for the 'silent cron with live container' pattern: only the
      // turn cron uses withMonitor. If withMonitor hangs (e.g., Sentry transport
      // queue stuck) the cron callback never completes. Logging tick-fired
      // outside the withMonitor wrap proves whether the cron scheduler itself
      // is firing or not.
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        lastProcessed: new Date(),
      });
      mockProcessTurn.mockResolvedValue({} as any);
      mockSchedule.mockReturnValue({ start: vi.fn(), stop: vi.fn(), getStatus: vi.fn() } as any);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();

      const callback = mockSchedule.mock.calls[0][1] as () => Promise<void>;
      await callback();

      const tickFiredLog = consoleLogSpy.mock.calls.findIndex((args: unknown[]) =>
        args.some((a) => typeof a === "string" && a.includes("[Cron] tick fired"))
      );
      const turnCheckLog = consoleLogSpy.mock.calls.findIndex((args: unknown[]) =>
        args.some((a) => typeof a === "string" && a.includes("Turn check triggered"))
      );
      expect(tickFiredLog).toBeGreaterThanOrEqual(0);
      expect(turnCheckLog).toBeGreaterThanOrEqual(0);
      expect(tickFiredLog).toBeLessThan(turnCheckLog); // fired BEFORE entering withMonitor
    });

    it("logs tick-completed with elapsed timing when Sentry.withMonitor returns normally", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        lastProcessed: new Date(),
      });
      mockProcessTurn.mockResolvedValue({} as any);
      mockSchedule.mockReturnValue({ start: vi.fn(), stop: vi.fn(), getStatus: vi.fn() } as any);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();

      const callback = mockSchedule.mock.calls[0][1] as () => Promise<void>;
      await callback();

      const completedLog = consoleLogSpy.mock.calls.some((args: unknown[]) =>
        args.some((a) => typeof a === "string" && /\[Cron\] tick completed in \d+ms/.test(a))
      );
      expect(completedLog).toBe(true);
    });

    it("logs tick-failed with elapsed timing and does NOT reject the cron callback when Sentry.withMonitor throws", async () => {
      // If withMonitor throws (rather than hangs), the cron callback must not
      // propagate the rejection — that would surface as unhandledRejection and
      // crashCapture would exit the process. Better to catch and log so the
      // schedule keeps firing on the next tick.
      const Sentry = await import("@sentry/nextjs");
      vi.mocked(Sentry.withMonitor).mockImplementationOnce(() => {
        throw new Error("withMonitor blew up");
      });

      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        lastProcessed: new Date(),
      });
      mockSchedule.mockReturnValue({ start: vi.fn(), stop: vi.fn(), getStatus: vi.fn() } as any);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();

      const callback = mockSchedule.mock.calls[0][1] as () => Promise<void>;
      // Must NOT reject — that would crash the process via unhandledRejection.
      await expect(callback()).resolves.toBeUndefined();

      const failedLog = consoleErrorSpy.mock.calls.some((args: unknown[]) =>
        args.some((a) => typeof a === "string" && /\[Cron\] tick failed after \d+ms/.test(a))
      );
      expect(failedLog).toBe(true);

      // Also forwards to Sentry so the alerting path doesn't regress vs. the
      // previous unhandledRejection → crashCapture → exit behavior.
      expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          tags: expect.objectContaining({ component: "turnCron", op: "withMonitor" }),
        })
      );
    });

    it("processes turn when game state is active", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        lastProcessed: new Date(),
      });
      mockProcessTurn.mockResolvedValue({
        corporationsProcessed: 10,
        sectorsProcessed: 25,
        totalRevenueGenerated: 1000000,
        totalIncomeGenerated: 500000,
      });
      const mockCronJob = {
        start: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      };
      mockSchedule.mockReturnValue(mockCronJob as any);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();

      const callback = mockSchedule.mock.calls[0][1];
      await callback();

      expect(mockProcessTurn).toHaveBeenCalled();
      // Check that log was called with the result object (any call containing "Turn processing result")
      const logCalls = consoleLogSpy.mock.calls;
      const foundResultLog = logCalls.some((call: unknown[]) =>
        call.some(
          (arg: unknown) =>
            typeof arg === "string" && arg.includes("[Cron] Turn processing result:")
        )
      );
      expect(foundResultLog).toBe(true);
    });

    it("logs error when turn processing fails", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        lastProcessed: new Date(),
      });
      mockProcessTurn.mockRejectedValue(new Error("Turn processing failed"));
      const mockCronJob = {
        start: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      };
      mockSchedule.mockReturnValue(mockCronJob as any);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();

      const callback = mockSchedule.mock.calls[0][1] as unknown as () => Promise<void>;
      await callback();

      // Check that error was logged with the message
      const errorCalls = consoleErrorSpy.mock.calls;
      const foundErrorLog = errorCalls.some((call) =>
        call.some(
          (arg) => typeof arg === "string" && arg.includes("[Cron] Error in turn processing:")
        )
      );
      expect(foundErrorLog).toBe(true);
    });

    it("logs cron trigger with timestamp", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        lastProcessed: new Date(),
      });
      mockProcessTurn.mockResolvedValue({} as any);
      const mockCronJob = {
        start: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      };
      mockSchedule.mockReturnValue(mockCronJob as any);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();

      const callback = mockSchedule.mock.calls[0][1] as unknown as () => Promise<void>;
      await callback();

      // Check that log was called with timestamp
      const logCalls = consoleLogSpy.mock.calls;
      const foundTimestampLog = logCalls.some((call: unknown[]) =>
        call.some(
          (arg: unknown) => typeof arg === "string" && arg.includes("Turn check triggered at")
        )
      );
      expect(foundTimestampLog).toBe(true);
    });

    it("reports a Sentry cron-monitor check-in on every callback fire", async () => {
      // External alerting on cron silence anchors on Sentry's monitor check-ins.
      // The turn callback must invoke Sentry.withMonitor each time it fires so a
      // missed check-in (process dead, container restarted without cron re-init)
      // becomes visible to Sentry's monitor alert.
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        lastProcessed: new Date(),
      });
      mockProcessTurn.mockResolvedValue({} as any);
      const mockCronJob = { start: vi.fn(), stop: vi.fn(), getStatus: vi.fn() };
      mockSchedule.mockReturnValue(mockCronJob as any);

      const Sentry = await import("@sentry/nextjs");
      const mockWithMonitor = vi.mocked(Sentry.withMonitor);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();
      const callback = mockSchedule.mock.calls[0][1] as unknown as () => Promise<void>;
      await callback();

      expect(mockWithMonitor).toHaveBeenCalledTimes(1);
      const [slug, wrappedFn] = mockWithMonitor.mock.calls[0];
      expect(typeof slug).toBe("string");
      expect(slug).toMatch(/^turn-cron/);
      expect(typeof wrappedFn).toBe("function");
    });

    it("monitor slug differentiates Railway services within the shared 'production' env", async () => {
      // Railway projects in this account have only one ENVIRONMENT_NAME
      // ('production') containing multiple services (Sandbox Staging, Main Site).
      // Using ENVIRONMENT_NAME alone would collapse both deployments onto a
      // single monitor — the slug derivation must prefer SERVICE_NAME and
      // produce a Sentry-safe slug (lowercase, hyphenated, no whitespace).
      const { deriveTurnCronMonitorSlug } = await import("./cron");

      expect(
        deriveTurnCronMonitorSlug({
          RAILWAY_SERVICE_NAME: "Sandbox Staging",
          RAILWAY_ENVIRONMENT_NAME: "production",
        } as unknown as NodeJS.ProcessEnv)
      ).toBe("turn-cron-sandbox-staging");

      expect(
        deriveTurnCronMonitorSlug({
          RAILWAY_SERVICE_NAME: "Main Site",
          RAILWAY_ENVIRONMENT_NAME: "production",
        } as unknown as NodeJS.ProcessEnv)
      ).toBe("turn-cron-main-site");

      // Falls back to env name when service name is absent.
      expect(
        deriveTurnCronMonitorSlug({
          RAILWAY_ENVIRONMENT_NAME: "production",
        } as unknown as NodeJS.ProcessEnv)
      ).toBe("turn-cron-production");

      // Falls back to "local" when neither is set (e.g., local dev).
      expect(deriveTurnCronMonitorSlug({} as NodeJS.ProcessEnv)).toBe("turn-cron-local");
    });

    it("check-in fires even when the turn is skipped (paused / locked)", async () => {
      // We want Sentry to see a check-in whenever the cron callback runs at all,
      // not only when processTurn() runs. Otherwise an admin-paused game would
      // look identical to a dead cron process to the external monitor.
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: false,
        lastProcessed: new Date(),
      });
      const mockCronJob = { start: vi.fn(), stop: vi.fn(), getStatus: vi.fn() };
      mockSchedule.mockReturnValue(mockCronJob as any);

      const Sentry = await import("@sentry/nextjs");
      const mockWithMonitor = vi.mocked(Sentry.withMonitor);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();
      const callback = mockSchedule.mock.calls[0][1] as unknown as () => Promise<void>;
      await callback();

      expect(mockWithMonitor).toHaveBeenCalledTimes(1);
      expect(mockProcessTurn).not.toHaveBeenCalled();
    });
  });

  describe("backup turn cron callback", () => {
    it("skips backup turn in fast mode", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        fastMode: true,
        lastProcessed: new Date(),
      });
      const mockCronJob = {
        start: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      };
      mockSchedule.mockReturnValue(mockCronJob as any);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();

      // backup cron is the second schedule call
      const backupCallback = mockSchedule.mock.calls[1][1];
      await backupCallback();

      expect(mockProcessTurn).not.toHaveBeenCalled();
    });

    it("skips backup turn when isProcessing is true with a fresh heartbeat", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        fastMode: false,
        isProcessing: true,
        processingHeartbeatAt: new Date(),
        lastProcessed: new Date(),
      });
      const mockCronJob = {
        start: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      };
      mockSchedule.mockReturnValue(mockCronJob as any);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();

      const backupCallback = mockSchedule.mock.calls[1][1];
      await backupCallback();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Cron] Backup turn skipped — turn already in progress")
      );
      expect(mockProcessTurn).not.toHaveBeenCalled();
    });

    it("falls through to processTurn on backup cron when the lock heartbeat is stale", async () => {
      // Same stuck-lock recovery as primary cron, for the non-fastMode backup
      // path. Without this, live (which doesn't run fastMode) would have no
      // backup recovery mechanism either.
      mockInitializeGameState.mockResolvedValue(undefined);
      const staleHeartbeat = new Date(Date.now() - 25 * 60 * 1000);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        fastMode: false,
        isProcessing: true,
        processingHeartbeatAt: staleHeartbeat,
        lastProcessed: new Date(),
      });
      mockShouldFireBackupTurn.mockResolvedValue(true);
      mockProcessTurn.mockResolvedValue({} as any);
      const mockCronJob = {
        start: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      };
      mockSchedule.mockReturnValue(mockCronJob as any);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();

      const backupCallback = mockSchedule.mock.calls[1][1] as () => Promise<void>;
      await backupCallback();

      expect(mockProcessTurn).toHaveBeenCalled();
    });

    it("skips backup turn when shouldFireBackupTurn returns false", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        fastMode: false,
        lastProcessed: new Date(),
      });
      mockShouldFireBackupTurn.mockResolvedValue(false);
      const mockCronJob = {
        start: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      };
      mockSchedule.mockReturnValue(mockCronJob as any);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();

      const backupCallback = mockSchedule.mock.calls[1][1];
      await backupCallback();

      expect(mockShouldFireBackupTurn).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Cron] Backup turn skipped — primary already processed this hour")
      );
      expect(mockProcessTurn).not.toHaveBeenCalled();
    });

    it("processes backup turn when shouldFireBackupTurn returns true", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        fastMode: false,
        lastProcessed: new Date(),
      });
      mockShouldFireBackupTurn.mockResolvedValue(true);
      mockProcessTurn.mockResolvedValue({
        corporationsProcessed: 10,
        sectorsProcessed: 25,
      });
      const mockCronJob = {
        start: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      };
      mockSchedule.mockReturnValue(mockCronJob as any);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();

      const backupCallback = mockSchedule.mock.calls[1][1];
      await backupCallback();

      expect(mockShouldFireBackupTurn).toHaveBeenCalled();
      expect(mockProcessTurn).toHaveBeenCalled();
      const logCalls = consoleLogSpy.mock.calls;
      const foundBackupLog = logCalls.some((call: unknown[]) =>
        call.some(
          (arg: unknown) => typeof arg === "string" && arg.includes("[Cron] Backup turn processed:")
        )
      );
      expect(foundBackupLog).toBe(true);
    });
  });

  // Added 2026-08-28. A process that dies mid-turn (redeploy SIGTERM, heapWatchdog
  // trip, hard V8 OOM) leaves isProcessing set with a frozen heartbeat. Recovery
  // used to depend on the :00 / :30 turn crons, so a turn killed at :05 stayed
  // wedged on "Processing..." until :30. This sweep bounds that to ~5 minutes past
  // the stale window — while never STARTING a turn that is merely due.
  describe("stuck turn-lock recovery sweep", () => {
    const STALE = new Date(Date.now() - 45 * 60 * 1000);
    const FRESH = new Date();

    function armCron() {
      const mockCronJob = { start: vi.fn(), stop: vi.fn(), getStatus: vi.fn() };
      mockSchedule.mockReturnValue(mockCronJob as any);
    }

    it("takes over when a processing lock has gone stale", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 457,
        isActive: true,
        isProcessing: true,
        processingKind: "turn",
        processingTargetTurn: 458,
        processingPhase: "bannedShareholderRelease",
        processingHeartbeatAt: STALE,
      });
      armCron();

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();
      await findScheduledCallback(STUCK_LOCK_SWEEP_SCHEDULE)();

      expect(mockProcessTurn).toHaveBeenCalledTimes(1);
    });

    it("leaves a healthy in-flight turn alone", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 457,
        isActive: true,
        isProcessing: true,
        processingKind: "turn",
        processingTargetTurn: 458,
        processingHeartbeatAt: FRESH,
      });
      armCron();

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();
      await findScheduledCallback(STUCK_LOCK_SWEEP_SCHEDULE)();

      expect(mockProcessTurn).not.toHaveBeenCalled();
    });

    // The load-bearing guarantee: this sweep is recovery-only. If it ever fell
    // through to processTurn on an idle game it would advance the game clock
    // every 5 minutes instead of hourly.
    it("never starts a turn when no lock is held", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 457,
        isActive: true,
        isProcessing: false,
      });
      armCron();

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();
      await findScheduledCallback(STUCK_LOCK_SWEEP_SCHEDULE)();

      expect(mockProcessTurn).not.toHaveBeenCalled();
    });

    // #1208: a turn that ran past the 20-minute stale threshold WITHOUT
    // heartbeating was taken over while still alive, re-running news-emitting
    // phases and posting duplicate World News. This sweep checks every 5 minutes
    // instead of every 30, so it must wait longer than the :00/:30 crons before
    // repossessing, or it sharply raises the odds of stealing from a turn that
    // is merely blocked rather than dead.
    it("waits longer than the turn crons before repossessing a stale lock", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 457,
        isActive: true,
        isProcessing: true,
        processingKind: "turn",
        processingTargetTurn: 458,
        // 25 minutes: past TURN_LOCK_STALE_MS (20 min), so the :00/:30 crons
        // would already act, but inside this sweep's doubled window.
        processingHeartbeatAt: new Date(Date.now() - 25 * 60 * 1000),
      });
      armCron();

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();
      await findScheduledCallback(STUCK_LOCK_SWEEP_SCHEDULE)();

      expect(mockProcessTurn).not.toHaveBeenCalled();
    });

    // gameState's processing lock is shared with other long operations. The
    // forex migration holds it as processingKind "forexMigration", and
    // processTurn's crash-recovery guard bails on a non-turn kind — so falling
    // through would run a NORMAL turn, advancing the game clock at an arbitrary
    // 5-minute boundary instead of on the hour.
    it("ignores a stale lock belonging to a non-turn operation", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 457,
        isActive: true,
        isProcessing: true,
        processingKind: "forexMigration",
        processingHeartbeatAt: STALE,
      });
      armCron();

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();
      await findScheduledCallback(STUCK_LOCK_SWEEP_SCHEDULE)();

      expect(mockProcessTurn).not.toHaveBeenCalled();
    });

    it("does nothing while the game is paused", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 457,
        isActive: false,
        isProcessing: true,
        processingHeartbeatAt: STALE,
      });
      armCron();

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();
      await findScheduledCallback(STUCK_LOCK_SWEEP_SCHEDULE)();

      expect(mockProcessTurn).not.toHaveBeenCalled();
    });
  });

  describe("stock exchange cron callback", () => {
    it("skips refresh when isProcessing is true with a fresh heartbeat", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        isProcessing: true,
        processingHeartbeatAt: new Date(),
        lastProcessed: new Date(),
      });
      const mockCronJob = {
        start: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      };
      mockSchedule.mockReturnValue(mockCronJob as any);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();

      // Select by cron expression, not call index: inserting a schedule ahead
      // of this one used to silently re-point these assertions at the wrong
      // callback (adding the stuck-lock sweep did exactly that).
      const stockCallback = findScheduledCallback(STOCK_EXCHANGE_SCHEDULE);
      await stockCallback();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Cron] Stock exchange refresh skipped — turn in progress")
      );
    });

    it("does not bail on stuck-isProcessing when the lock is stale", async () => {
      // Regression: railway logs during the 2026-05-24 sandbox incident show
      // "[Cron] Stock exchange refresh skipped — turn in progress" repeating
      // for hours while a crashed turn left isProcessing=true. A stale lock
      // means no real turn is in flight, so the refresh must proceed.
      mockInitializeGameState.mockResolvedValue(undefined);
      const staleHeartbeat = new Date(Date.now() - 25 * 60 * 1000);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        isProcessing: true,
        processingHeartbeatAt: staleHeartbeat,
        lastProcessed: new Date(),
      });
      const mockCronJob = {
        start: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      };
      mockSchedule.mockReturnValue(mockCronJob as any);

      const { initializeCronJobs } = await import("./cron");
      await initializeCronJobs();

      const stockCallback = findScheduledCallback(STOCK_EXCHANGE_SCHEDULE);
      await stockCallback();

      // Must NOT have logged the stuck-isProcessing bail-out.
      const skipLogs = consoleLogSpy.mock.calls.filter((args: unknown[]) =>
        args.some(
          (a) =>
            typeof a === "string" &&
            a.includes("[Cron] Stock exchange refresh skipped — turn in progress")
        )
      );
      expect(skipLogs).toHaveLength(0);
    });
  });

  describe("stopCronJobs", () => {
    it("stops cron job and sets to null", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        lastProcessed: new Date(),
      });
      const mockCronJob = {
        start: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      };
      mockSchedule.mockReturnValue(mockCronJob as any);

      const { initializeCronJobs, stopCronJobs } = await import("./cron");
      await initializeCronJobs();
      stopCronJobs();

      expect(mockCronJob.stop).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Cron] Cron jobs stopped")
      );
    });

    it("logs stop message even when cron job is not initialized", async () => {
      // stopCronJobs always emits the "jobs stopped" log — the function is
      // idempotent and the log tracks intent, not actual state changes.
      const { stopCronJobs } = await import("./cron");
      stopCronJobs();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Cron] Cron jobs stopped")
      );
    });
  });

  describe("getCronStatus", () => {
    it("returns running: false when cron not initialized", async () => {
      const { getCronStatus } = await import("./cron");
      const status = getCronStatus();
      expect(status.running).toBe(false);
    });

    it("returns running: true when cron is initialized", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        lastProcessed: new Date(),
      });
      const mockCronJob = {
        start: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      };
      mockSchedule.mockReturnValue(mockCronJob as any);

      const { initializeCronJobs, getCronStatus } = await import("./cron");
      await initializeCronJobs();

      const status = getCronStatus();
      expect(status.running).toBe(true);
    });

    it("returns running: false after cron is stopped", async () => {
      mockInitializeGameState.mockResolvedValue(undefined);
      mockGetGameState.mockResolvedValue({
        currentTurn: 1,
        isActive: true,
        lastProcessed: new Date(),
      });
      const mockCronJob = {
        start: vi.fn(),
        stop: vi.fn(),
        getStatus: vi.fn(),
      };
      mockSchedule.mockReturnValue(mockCronJob as any);

      const { initializeCronJobs, stopCronJobs, getCronStatus } = await import("./cron");
      await initializeCronJobs();
      stopCronJobs();

      const status = getCronStatus();
      expect(status.running).toBe(false);
    });
  });
});
