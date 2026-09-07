"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The one control a singleplayer world needs that multiplayer never shows:
 * turns advance when the player says so, or on a player-selected local timer.
 * It deliberately talks only to the loopback-only singleplayer route. The
 * local player is never an administrator merely to run their own world.
 */
export function SingleplayerEndTurnButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timerMinutes, setTimerMinutes] = useState(5);
  const [timerRunning, setTimerRunning] = useState(false);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem("ahd.singleplayer.turnTimerMinutes"));
    if (Number.isInteger(saved) && saved >= 1 && saved <= 1_440) setTimerMinutes(saved);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("ahd.singleplayer.turnTimerMinutes", String(timerMinutes));
  }, [timerMinutes]);

  const endTurn = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/singleplayer/turn/advance", { method: "POST" });
      const body = (await res.json().catch(() => null)) as {
        message?: string;
        error?: string;
      } | null;
      if (!res.ok) {
        setError(body?.error ?? body?.message ?? `Turn failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Turn failed");
    } finally {
      setBusy(false);
    }
  }, [busy, router]);

  useEffect(() => {
    if (!timerRunning) return;
    const handle = window.setInterval(() => void endTurn(), timerMinutes * 60_000);
    return () => window.clearInterval(handle);
  }, [endTurn, timerMinutes, timerRunning]);

  return (
    <div className="relative ml-1 flex items-center gap-1">
      <button
        type="button"
        onClick={() => void endTurn()}
        disabled={busy}
        title={error ?? "Advance the world by one turn"}
        className="inline-flex items-center gap-2 rounded border border-primary/60 bg-primary/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-primary transition hover:bg-primary/20 disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? (
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        ) : null}
        {busy ? "Running turn" : "End turn"}
      </button>
      <details className="group relative">
        <summary className="cursor-pointer list-none rounded border border-card-border px-2 py-1.5 text-xs text-muted transition hover:text-foreground">
          Timer
        </summary>
        <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded border border-card-border bg-background p-3 text-xs shadow-lg">
          <label className="block font-medium text-foreground" htmlFor="singleplayer-turn-timer">
            Advance every
          </label>
          <div className="mt-2 flex items-center gap-2">
            <input
              id="singleplayer-turn-timer"
              type="number"
              min={1}
              max={1440}
              value={timerMinutes}
              disabled={timerRunning}
              onChange={(event) =>
                setTimerMinutes(Math.min(1_440, Math.max(1, event.target.valueAsNumber || 1)))
              }
              className="w-16 rounded border border-card-border bg-card px-2 py-1"
            />
            <span>minutes</span>
          </div>
          <button
            type="button"
            onClick={() => setTimerRunning((running) => !running)}
            className="mt-3 w-full rounded bg-primary px-2 py-1.5 font-semibold text-white"
          >
            {timerRunning ? "Stop automatic turns" : "Start automatic turns"}
          </button>
          {timerRunning ? (
            <p className="mt-2 text-muted">
              The next turn runs after {timerMinutes} minute{timerMinutes === 1 ? "" : "s"}.
            </p>
          ) : null}
        </div>
      </details>
      {error ? (
        <div
          role="alert"
          className="absolute right-0 top-full z-50 mt-1 w-64 rounded border border-red-500/40 bg-background p-2 text-xs text-red-400 shadow-lg"
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
