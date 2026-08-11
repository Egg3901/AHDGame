"use client";

import { useState, useEffect } from "react";
import { formatDate, getMessageStyle, turnToLarpDate } from "@/lib/utils/formatters";
import { Skeleton } from "@/components/ui";

interface GameState {
  currentTurn: number;
  currentYear: number;
  /** Year the active preset started in — needed so the LARP date display
   *  reads "Week 1, 1991" on a 1991 reset instead of falling back to 2019. */
  startingYear?: number;
  isActive: boolean;
  isProcessing: boolean;
  lastTurnProcessed: string;
  nextScheduledTurn: string | null;
  pausedAt: string | null;
  pauseReason: string | null;
  pauseKind: "manual" | "auto-drift" | null;
  processingPhase: string | null;
  processingTargetTurn: number | null;
  processingHeartbeatAt: string | null;
  processingStartedAt: string | null;
  canResetProcessingLock: boolean;
  processingLockRetryAfterSeconds: number | null;
  processingLockStaleAt: string | null;
  corporationActionsPaused: boolean;
  playerTransfersPaused: boolean;
  playerRandomEventsEnabled: boolean;
  fastMode: boolean;
}

type OperationMode = "idle" | "manual" | "batch";

function formatLockCountdown(totalSeconds: number | null): string {
  if (totalSeconds == null) return "soon";
  const seconds = Math.max(0, totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
  return `${remainder}s`;
}

function ControlBtn({
  onClick,
  disabled,
  variant = "ghost",
  children,
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  variant?: "ghost" | "primary" | "danger" | "success" | "muted";
  children: React.ReactNode;
  title?: string;
}) {
  const cls: Record<string, string> = {
    ghost: "border-card-border text-muted hover:text-foreground hover:border-foreground/30",
    primary: "border-primary/50 text-primary hover:bg-primary/10",
    danger: "border-red-500/50 text-red-400 hover:bg-red-500/10",
    success: "border-green-500/50 text-green-400 hover:bg-green-500/10",
    muted: "border-card-border text-muted hover:text-foreground hover:border-foreground/30",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg border px-4 py-2.5 text-sm font-semibold transition-all disabled:opacity-35 disabled:cursor-not-allowed hover:scale-105 ${cls[variant]}`}
    >
      {children}
    </button>
  );
}

function StatusBadge({
  active,
  label,
  color,
  pulse,
}: {
  active: boolean;
  label: string;
  color: string;
  pulse?: boolean;
}) {
  if (!active) return null;
  // Derive opacity-modified background (e.g. "bg-green-500" → "bg-green-500/10")
  // and text color (e.g. "bg-green-500" → "text-green-500") from the color prop.
  const bgTint = `${color}/10`;
  const textColor = color.replace("bg-", "text-");
  return (
    <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 ${bgTint}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${color} ${pulse ? "animate-pulse" : ""}`} />
      <span className={`text-sm font-semibold ${textColor}`}>{label}</span>
    </div>
  );
}

export function TurnControls() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [batchCount, setBatchCount] = useState<number | "">(6);
  const [operationMode, setOperationMode] = useState<OperationMode>("idle");
  const [batchProgress, setBatchProgress] = useState<{ completed: number; total: number } | null>(
    null
  );
  const [turnProgress, setTurnProgress] = useState(0);
  const [currentPhase, setCurrentPhase] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [lastCompletion, setLastCompletion] = useState<{
    turns: number;
    durationSeconds: number;
  } | null>(null);

  useEffect(() => {
    fetchGameState();
    const interval = setInterval(fetchGameState, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!lastCompletion) return;
    const t = setTimeout(() => setLastCompletion(null), 5000);
    return () => clearTimeout(t);
  }, [lastCompletion]);

  const fetchGameState = async (bypassCache = false) => {
    try {
      const res = await fetch("/api/game/turn/status", bypassCache ? { cache: "no-store" } : {});
      if (res.ok) setGameState(await res.json());
    } catch (error) {
      console.error("Failed to fetch game state:", error);
    }
  };

  const startPhasePolling = () => {
    return setInterval(async () => {
      try {
        const r = await fetch("/api/game/turn/status", { cache: "no-store" });
        if (r.ok) {
          const d = await r.json();
          setCurrentPhase(d.processingPhaseLabel ?? d.processingPhase ?? null);
          if (typeof d.processingProgress === "number") {
            setTurnProgress(d.processingProgress);
          }
        }
      } catch {}
    }, 900);
  };

  const callAdmin = async (path: string, label: string) => {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch(path, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setMessage(`✓ ${data.message}`);
        await fetchGameState(true);
      } else {
        setMessage(`✗ ${data.error || `Failed to ${label}`}`);
      }
    } catch {
      setMessage("✗ Network error");
    } finally {
      setLoading(false);
    }
  };

  const toggleRandomEvents = async () => {
    const enabling = !gameState?.playerRandomEventsEnabled;
    if (
      enabling &&
      !confirm(
        "Enable player random events? Approved templates will begin firing on the next turn cycle."
      )
    ) {
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/events/pree/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: enabling }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(
          data.warning
            ? `⚠ ${data.warning}`
            : `✓ Random events ${enabling ? "enabled" : "disabled"}`
        );
        await fetchGameState(true);
      } else {
        setMessage(`✗ ${data.error || "Failed to toggle random events"}`);
      }
    } catch {
      setMessage("✗ Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleManualTurn = async () => {
    if (!confirm("Manually process a turn now? This immediately advances the game.")) return;
    setOperationMode("manual");
    setLoading(true);
    setMessage("");
    setLastCompletion(null);
    setCurrentPhase(null);
    setTurnProgress(0);
    const poll = startPhasePolling();
    try {
      const res = await fetch("/api/admin/turn/process", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setTurnProgress(100);
        setCurrentPhase("Done");
        setLastCompletion({ turns: 1, durationSeconds: data.durationSeconds ?? 0 });
        setMessage("");
        await fetchGameState(true);
      } else {
        setMessage(`✗ ${data.error || "Failed to process turn"}`);
      }
    } catch {
      setMessage("✗ Network error");
    } finally {
      clearInterval(poll);
      setLoading(false);
      setOperationMode("idle");
      setCurrentPhase(null);
      setTurnProgress(0);
    }
  };

  const handleBatchTurns = async () => {
    const n = Number(batchCount);
    if (!n || n < 1 || n > 20) {
      setMessage("✗ Enter a number between 1 and 20.");
      return;
    }
    if (!confirm(`Process ${n} turns sequentially now? This cannot be undone.`)) return;

    setOperationMode("batch");
    setBatchProgress({ completed: 0, total: n });
    setLoading(true);
    setMessage("");
    setLastCompletion(null);
    setCurrentPhase(null);
    setTurnProgress(0);
    const poll = startPhasePolling();
    let completed = 0;
    try {
      for (let i = 0; i < n; i++) {
        setTurnProgress(0);
        setCurrentPhase(null);
        const res = await fetch("/api/admin/turn/process", { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
          setMessage(`✗ Turn ${i + 1} failed: ${data.error || "Unknown error"}`);
          break;
        }
        completed = i + 1;
        setBatchProgress({ completed, total: n });
      }
      if (completed === n) {
        setLastCompletion({ turns: n, durationSeconds: 0 });
      }
      await fetchGameState(true);
    } catch {
      setMessage("✗ Network error");
    } finally {
      clearInterval(poll);
      setLoading(false);
      setOperationMode("idle");
      setBatchProgress(null);
      setCurrentPhase(null);
      setTurnProgress(0);
    }
  };

  const isProcessing = loading && operationMode !== "idle";

  const overlayProgress =
    operationMode === "batch" && batchProgress
      ? Math.round(((batchProgress.completed + turnProgress / 100) / batchProgress.total) * 100)
      : turnProgress;

  return (
    <div className="relative overflow-hidden rounded-xl border border-card-border bg-card shadow-lg">
      {/* Processing overlay */}
      {isProcessing && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 bg-card/95 backdrop-blur-sm px-10">
          <div className="w-full max-w-sm space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-foreground">
                {operationMode === "batch" ? "Processing turns…" : "Processing turn…"}
              </span>
              <span className="text-muted tabular-nums">{overlayProgress}%</span>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-card-border">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${overlayProgress}%` }}
              />
            </div>

            <p className="truncate text-xs text-muted">
              {operationMode === "batch" && batchProgress
                ? `Turn ${batchProgress.completed} of ${batchProgress.total}${
                    currentPhase ? ` · ${currentPhase}` : ""
                  }`
                : (currentPhase ?? "Starting…")}
            </p>
          </div>
        </div>
      )}

      {/* Header - Game Clock */}
      <div className="border-b border-card-border bg-gradient-to-r from-primary/5 to-transparent px-6 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">Game Clock</h2>
            <p className="text-xs text-muted">Real-time turn management</p>
          </div>
          {gameState && (
            <div className="text-right">
              <div className="text-3xl font-bold text-primary">Turn {gameState.currentTurn}</div>
              <div className="text-sm text-muted">
                {turnToLarpDate(gameState.currentTurn, gameState.startingYear)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status indicators */}
      <div className="flex flex-wrap items-center gap-3 border-b border-card-border px-6 py-4">
        {gameState ? (
          <>
            <StatusBadge
              active={gameState.isActive}
              label={
                gameState.isActive
                  ? "Cron Active"
                  : gameState.pauseKind === "auto-drift"
                    ? "Auto-Paused"
                    : "Paused"
              }
              color={
                gameState.isActive
                  ? "bg-green-500"
                  : gameState.pauseKind === "auto-drift"
                    ? "bg-red-700"
                    : "bg-red-500"
              }
              pulse={gameState.isActive}
            />
            <StatusBadge
              active={gameState.corporationActionsPaused}
              label="Corp Paused"
              color="bg-yellow-500"
            />
            <StatusBadge
              active={gameState.playerTransfersPaused}
              label="Transfers Paused"
              color="bg-orange-500"
            />
            <StatusBadge
              active={gameState.playerRandomEventsEnabled}
              label="Events"
              color="bg-amber-500"
            />
            <StatusBadge
              active={gameState.fastMode}
              label="Fast Mode (30m)"
              color="bg-purple-500"
              pulse
            />
            <StatusBadge
              active={gameState.isProcessing}
              label="Processing…"
              color="bg-yellow-500"
              pulse
            />
            <div className="ml-auto flex flex-col items-end text-xs text-muted">
              {gameState.isProcessing && gameState.processingPhase && (
                <span>
                  Phase: {gameState.processingPhase}
                  {gameState.processingTargetTurn != null
                    ? ` (turn ${gameState.processingTargetTurn})`
                    : ""}
                </span>
              )}
              <span>
                Game time:{" "}
                {gameState.lastTurnProcessed ? formatDate(gameState.lastTurnProcessed) : "—"}
              </span>
              {gameState.isActive && gameState.nextScheduledTurn && (
                <span>Next cron: {formatDate(gameState.nextScheduledTurn)}</span>
              )}
              {gameState.isProcessing && !gameState.canResetProcessingLock && (
                <span>
                  Reset lock available in about{" "}
                  {formatLockCountdown(gameState.processingLockRetryAfterSeconds)}
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="flex min-h-10 w-full flex-wrap items-center gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-24 rounded-full" />
            ))}
            <div className="ml-auto flex flex-col items-end gap-1">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        )}
      </div>

      {gameState?.pauseKind === "auto-drift" && (
        <div className="border-b border-card-border bg-error/5 px-6 py-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-error">
            Cron auto-paused
          </div>
          <div className="mt-1 text-sm text-error/90">{gameState.pauseReason}</div>
          {gameState.pausedAt && (
            <div className="mt-0.5 text-[11px] text-error/70">
              Paused at {formatDate(gameState.pausedAt)}
            </div>
          )}
        </div>
      )}

      {/* Feature toggles — dedicated row so Forex + Fast Mode stay discoverable
          once Forex is enabled and the legacy "Enable Forex" button hides. */}
      <div className="border-b border-card-border px-6 py-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">
            Feature toggles
          </h3>
          <span className="text-[10px] text-muted">Global game settings</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Fast mode */}
          <div className="flex items-center justify-between rounded-lg border border-card-border bg-background/40 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">Fast mode</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    gameState?.fastMode
                      ? "bg-purple-500/15 text-purple-400"
                      : "bg-muted/15 text-muted"
                  }`}
                >
                  {gameState?.fastMode ? "30m turns" : "60m turns"}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {gameState?.fastMode
                  ? "Turns process every 30 minutes. Click to return to 60-minute cycles."
                  : "Default 60-minute cycles. Click to speed up to 30-minute turns."}
              </p>
            </div>
            <ControlBtn
              onClick={() => callAdmin("/api/admin/turn/toggle-fast-mode", "toggle fast mode")}
              disabled={loading}
              variant={gameState?.fastMode ? "success" : "muted"}
              title={
                gameState?.fastMode
                  ? "Disable fast mode — return to 60-minute turns"
                  : "Enable fast mode — turns every 30 minutes"
              }
            >
              {gameState?.fastMode ? "Disable" : "Enable"}
            </ControlBtn>
          </div>

          {/* Random events */}
          <div className="flex items-center justify-between rounded-lg border border-card-border bg-background/40 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">Random events</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    gameState?.playerRandomEventsEnabled
                      ? "bg-amber-500/15 text-amber-500"
                      : "bg-muted/15 text-muted"
                  }`}
                >
                  {gameState?.playerRandomEventsEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {gameState?.playerRandomEventsEnabled
                  ? "Approved event templates fire each turn. Disabling stops new offers; pending events still resolve."
                  : "Player random events are off. Approved templates fire on the next turn cycle once enabled."}
              </p>
            </div>
            <ControlBtn
              onClick={toggleRandomEvents}
              disabled={loading}
              variant={gameState?.playerRandomEventsEnabled ? "success" : "muted"}
              title={
                gameState?.playerRandomEventsEnabled
                  ? "Disable random events — stops new offers, pending events still resolve"
                  : "Enable random events — approved templates begin firing next turn"
              }
            >
              {gameState?.playerRandomEventsEnabled ? "Disable" : "Enable"}
            </ControlBtn>
          </div>
        </div>
      </div>

      {/* Control buttons */}
      <div className="grid grid-cols-1 gap-3 border-b border-card-border px-3 py-5 sm:grid-cols-2 sm:px-6 md:grid-cols-4 lg:grid-cols-5">
        <ControlBtn
          onClick={() => {
            if (gameState?.pauseKind === "auto-drift") {
              const pauseMs = gameState.pausedAt
                ? Date.now() - new Date(gameState.pausedAt).getTime()
                : 0;
              const hours = Math.round(pauseMs / 3_600_000);
              const proceed = confirm(
                `Cron was auto-paused because turn processing drifted behind real time. ` +
                  `On resume, every active/upcoming election's startTime, primaryEndTime, ` +
                  `and endTime will shift forward by ~${hours} hours to compensate. ` +
                  `Investigate the underlying cause before continuing.\n\nProceed?`
              );
              if (!proceed) return;
            }
            void callAdmin("/api/admin/turn/start", "start");
          }}
          disabled={loading || gameState?.isActive === true}
          variant="success"
        >
          Start Cron
        </ControlBtn>
        <ControlBtn
          onClick={() => callAdmin("/api/admin/turn/stop", "stop")}
          disabled={loading || gameState?.isActive === false}
          variant="danger"
        >
          Pause Cron
        </ControlBtn>
        <ControlBtn
          onClick={() =>
            callAdmin("/api/admin/turn/toggle-corporation-actions", "toggle corp actions")
          }
          disabled={loading}
          variant={gameState?.corporationActionsPaused ? "success" : "danger"}
          title={
            gameState?.corporationActionsPaused
              ? "Resume corporation actions"
              : "Pause corporation actions"
          }
        >
          {gameState?.corporationActionsPaused ? "Resume Corp" : "Pause Corp"}
        </ControlBtn>
        <ControlBtn
          onClick={() =>
            callAdmin("/api/admin/turn/toggle-player-transfers", "toggle player transfers")
          }
          disabled={loading}
          variant={gameState?.playerTransfersPaused ? "success" : "danger"}
          title={
            gameState?.playerTransfersPaused
              ? "Resume player-to-player transfers"
              : "Pause player-to-player transfers"
          }
        >
          {gameState?.playerTransfersPaused ? "Resume Transfers" : "Pause Transfers"}
        </ControlBtn>
        <ControlBtn onClick={handleManualTurn} disabled={loading} variant="primary">
          Manual Turn
        </ControlBtn>
        {gameState?.isProcessing && (
          <ControlBtn
            onClick={() => {
              if (!gameState.canResetProcessingLock) {
                setMessage(
                  `× Reset Lock becomes available in about ${formatLockCountdown(gameState.processingLockRetryAfterSeconds)} once the 20-minute stale window passes.`
                );
                return;
              }
              if (
                !confirm(
                  "Force-clear the stuck processing lock? Only do this if turn processing has been stuck for 20+ minutes."
                )
              )
                return;
              callAdmin("/api/admin/turn/reset-lock", "reset lock");
            }}
            disabled={loading}
            variant={gameState.canResetProcessingLock ? "danger" : "muted"}
            title={
              gameState.canResetProcessingLock
                ? "Clear a stale isProcessing lock after the 20-minute stale window"
                : `Reset Lock becomes available in about ${formatLockCountdown(gameState.processingLockRetryAfterSeconds)}`
            }
          >
            Reset Lock
          </ControlBtn>
        )}

        {/* Batch controls */}
        <div className="flex overflow-hidden rounded-lg border border-card-border">
          <input
            type="number"
            min={1}
            max={20}
            value={batchCount}
            onChange={(e) =>
              setBatchCount(
                e.target.value === ""
                  ? ""
                  : Math.min(20, Math.max(1, parseInt(e.target.value) || 1))
              )
            }
            disabled={loading}
            className="w-14 border-r border-card-border bg-transparent px-3 py-2 text-center text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 disabled:opacity-40"
          />
          <button
            onClick={handleBatchTurns}
            disabled={loading || !batchCount}
            className="px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-35"
          >
            Batch
          </button>
        </div>

        <ControlBtn
          onClick={() => callAdmin("/api/admin/config/init", "initialize config")}
          disabled={loading}
          variant="muted"
          title="Init config"
        >
          Config
        </ControlBtn>
        <ControlBtn
          onClick={() => callAdmin("/api/admin/turn/init", "initialize system")}
          disabled={loading}
          variant="muted"
          title="Init system"
        >
          System
        </ControlBtn>

        <button
          onClick={() => setShowHelp(!showHelp)}
          title="Help"
          aria-label="Help"
          className="rounded-lg border border-transparent p-2 transition-colors hover:border-card-border hover:text-foreground"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </button>
      </div>

      {/* Completion banner */}
      {lastCompletion && (
        <div className="flex items-center gap-3 border-b border-green-500/20 bg-green-500/10 px-6 py-3">
          <svg
            className="h-5 w-5 flex-shrink-0 text-green-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-base font-semibold text-green-400">
            {lastCompletion.turns === 1
              ? "Turn complete"
              : `${lastCompletion.turns} turns complete`}
            <span className="ml-2 text-sm opacity-70">({lastCompletion.durationSeconds}s)</span>
          </span>
        </div>
      )}

      {/* Message */}
      {message && (
        <div className="px-6 py-3">
          <span className={`rounded-lg px-3 py-2 text-sm ${getMessageStyle(message)}`}>
            {message}
          </span>
        </div>
      )}

      {/* Help */}
      {showHelp && (
        <div className="border-t border-card-border bg-background/50 px-6 py-4">
          <p className="text-sm leading-relaxed text-muted">
            <strong className="text-foreground">Start/Pause Cron:</strong> Toggle automatic turn
            processing. <strong className="text-foreground">Pause/Resume Corp:</strong> Block sector
            splits/attacks (shares still allowed).{" "}
            <strong className="text-foreground">Manual Turn:</strong> Process 1 turn immediately.{" "}
            <strong className="text-foreground">Batch:</strong> Process 1–20 turns sequentially.{" "}
            <strong className="text-foreground">Enable Forex:</strong> One-time migration to
            activate currency exchange (irreversible).{" "}
            <strong className="text-foreground">Fast Mode:</strong> Toggle 30-minute turn cycles
            (default: 60 minutes). <strong className="text-foreground">Config/System:</strong>{" "}
            First-time setup only.
          </p>
        </div>
      )}
    </div>
  );
}
