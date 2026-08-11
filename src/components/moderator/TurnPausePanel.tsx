"use client";

import { useCallback, useEffect, useState } from "react";

interface GameState {
  currentTurn: number;
  isActive: boolean;
  nextScheduledTurn: string | null;
  pausedAt: string | null;
  pauseReason: string | null;
  pauseKind: "manual" | "auto-drift" | null;
  corporationActionsPaused: boolean;
}

export function TurnPausePanel() {
  const [state, setState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<"turns" | "corp" | null>(null);
  const [message, setMessage] = useState("");

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/game/turn/status", { cache: "no-store" });
      if (res.ok) setState(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const t = setInterval(fetchStatus, 30000);
    return () => clearInterval(t);
  }, [fetchStatus]);

  const toggleTurns = async () => {
    if (!state) return;
    const pausing = state.isActive;
    const prompt = pausing
      ? "Pause the turn system? Cron-scheduled turns will stop processing until restarted."
      : "Resume the turn system? Scheduled turns will process again on the cron.";
    if (!confirm(prompt)) return;

    setBusyKey("turns");
    setMessage("");
    try {
      const path = pausing ? "/api/admin/turn/stop" : "/api/admin/turn/start";
      const res = await fetch(path, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setMessage(`✓ ${data.message}`);
        await fetchStatus();
      } else {
        setMessage(`✗ ${data.error || "Operation failed"}`);
      }
    } catch {
      setMessage("✗ Network error");
    } finally {
      setBusyKey(null);
    }
  };

  const toggleCorp = async () => {
    if (!state) return;
    const pausing = !state.corporationActionsPaused;
    const prompt = pausing
      ? "Pause corporation actions? Corporate phases will be skipped during turn processing."
      : "Resume corporation actions? Corporate phases will run normally during turn processing.";
    if (!confirm(prompt)) return;

    setBusyKey("corp");
    setMessage("");
    try {
      const res = await fetch("/api/admin/turn/toggle-corporation-actions", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setMessage(`✓ ${data.message}`);
        await fetchStatus();
      } else {
        setMessage(`✗ ${data.error || "Operation failed"}`);
      }
    } catch {
      setMessage("✗ Network error");
    } finally {
      setBusyKey(null);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted">Loading turn status...</span>
        </div>
      </div>
    );
  }

  const running = state?.isActive === true;
  const corpRunning = state?.corporationActionsPaused !== true;

  return (
    <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Turn system</h3>
          <p className="text-xs text-muted">
            Pauses or resumes the hourly cron. Does not roll back or fast-forward any turn.
          </p>
        </div>
        <span
          className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
          style={{
            background: running ? "rgba(34, 197, 94, 0.15)" : "rgba(234, 179, 8, 0.15)",
            color: running ? "var(--success)" : "var(--warning)",
          }}
        >
          {running ? "Running" : "Paused"}
        </span>
      </div>
      <button
        type="button"
        onClick={toggleTurns}
        disabled={busyKey !== null}
        className="inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium text-white transition-colors disabled:opacity-50"
        style={{ background: running ? "var(--warning)" : "var(--success)" }}
      >
        {busyKey === "turns" ? "Updating..." : running ? "Pause turns" : "Resume turns"}
      </button>
      {state && (
        <div className="mt-3 space-y-1 text-xs text-muted">
          <p>
            Current turn: <span className="font-medium text-foreground">{state.currentTurn}</span>
          </p>
          {!running && state.pausedAt && (
            <p>
              Paused at{" "}
              <span className="font-medium text-foreground">
                {new Date(state.pausedAt).toLocaleString("en-US")}
              </span>
              {state.pauseKind === "auto-drift" && (
                <span className="ml-2 rounded bg-error/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-error">
                  Auto-paused
                </span>
              )}
            </p>
          )}
          {!running && state.pauseReason && (
            <p className="text-foreground/80">{state.pauseReason}</p>
          )}
          {running && state.nextScheduledTurn && (
            <p>
              Next scheduled turn:{" "}
              <span className="font-medium text-foreground">
                {new Date(state.nextScheduledTurn).toLocaleString("en-US")}
              </span>
            </p>
          )}
        </div>
      )}

      <div className="mt-5 border-t border-card-border pt-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Corporation actions</h3>
            <p className="text-xs text-muted">
              When paused, corporate phases are skipped during turn processing. Player turns still
              run.
            </p>
          </div>
          <span
            className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
            style={{
              background: corpRunning ? "rgba(34, 197, 94, 0.15)" : "rgba(234, 179, 8, 0.15)",
              color: corpRunning ? "var(--success)" : "var(--warning)",
            }}
          >
            {corpRunning ? "Active" : "Paused"}
          </span>
        </div>
        <button
          type="button"
          onClick={toggleCorp}
          disabled={busyKey !== null}
          className="inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium text-white transition-colors disabled:opacity-50"
          style={{ background: corpRunning ? "var(--warning)" : "var(--success)" }}
        >
          {busyKey === "corp"
            ? "Updating..."
            : corpRunning
              ? "Pause corp actions"
              : "Resume corp actions"}
        </button>
      </div>

      {message && (
        <div
          className={`mt-4 rounded-lg border px-3 py-2 text-xs ${
            message.startsWith("✓")
              ? "border-green-500/30 bg-green-500/10 text-green-400"
              : "border-error/30 bg-error/10 text-error"
          }`}
        >
          {message}
        </div>
      )}
    </div>
  );
}
