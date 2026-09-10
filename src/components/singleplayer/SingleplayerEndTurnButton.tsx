"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { refreshGameTurnStatus } from "@/hooks/useGameEvents";
import { useAuthMe } from "@/contexts/AuthDataContext";

/**
 * The one control a singleplayer world needs that multiplayer never shows:
 * turns advance when the player says so, or on a player-selected local timer.
 * It deliberately talks only to the loopback-only singleplayer route. The
 * local player is never an administrator merely to run their own world.
 */
export function SingleplayerEndTurnButton() {
  const t = useTranslations("nav.singleplayer");
  const router = useRouter();
  const { navData, refetch } = useAuthMe();
  const worldsim = navData?.user?.singleplayerMode === "worldsim";
  const canAdvance = navData?.hasCharacter === true || worldsim;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [briefing, setBriefing] = useState<{
    turn: number;
    fundsDelta: number;
    actionsDelta: number;
  } | null>(null);
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
    if (busy || !canAdvance) return;
    setBusy(true);
    setError(null);
    try {
      const res = worldsim
        ? await fetch("/api/singleplayer/worldsim/advance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ turns: 1 }),
          })
        : await fetch("/api/singleplayer/turn/advance", { method: "POST" });
      const body = (await res.json().catch(() => null)) as {
        turn?: number;
        briefing?: { fundsDelta: number; actionsDelta: number };
        message?: string;
        error?: string;
      } | null;
      if (!res.ok) {
        setTimerRunning(false);
        const message = body?.error ?? body?.message ?? t("failedStatus", { status: res.status });
        setError(message);
        window.dispatchEvent(new CustomEvent("ahd:turn-error", { detail: { message } }));
        return;
      }
      if (body?.turn && body.briefing) setBriefing({ turn: body.turn, ...body.briefing });
      await refreshGameTurnStatus();
      refetch();
      window.dispatchEvent(new Event("ahd:turn-complete"));
      router.refresh();
    } catch (err) {
      setTimerRunning(false);
      const message = err instanceof Error ? err.message : t("failed");
      setError(message);
      window.dispatchEvent(new CustomEvent("ahd:turn-error", { detail: { message } }));
    } finally {
      setBusy(false);
    }
  }, [busy, canAdvance, refetch, router, worldsim, t]);

  useEffect(() => {
    if (!timerRunning || !canAdvance) return;
    const handle = window.setInterval(() => void endTurn(), timerMinutes * 60_000);
    return () => window.clearInterval(handle);
  }, [endTurn, canAdvance, timerMinutes, timerRunning]);

  return (
    <div className="relative ml-1 flex items-center gap-1">
      {navData?.user?.singleplayerMode === "head-of-state" && (
        <span className="text-xs text-muted">{t("headOfState")}</span>
      )}
      {worldsim && <span className="text-xs text-muted">{t("worldsim")}</span>}
      <button
        type="button"
        onClick={() => void endTurn()}
        disabled={busy || !canAdvance}
        title={!canAdvance ? t("needsCharacter") : (error ?? t("advanceHint"))}
        className="inline-flex items-center gap-2 rounded border border-primary/60 bg-primary/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-primary transition hover:bg-primary/20 disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? (
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        ) : null}
        {busy ? t("running") : t("endTurn")}
      </button>
      <details className="group relative">
        <summary className="cursor-pointer list-none rounded border border-card-border px-2 py-1.5 text-xs text-muted transition hover:text-foreground">
          {t("timer")}
        </summary>
        <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded border border-card-border bg-background p-3 text-xs shadow-lg">
          <label className="block font-medium text-foreground" htmlFor="singleplayer-turn-timer">
            {t("advanceEvery")}
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
            <span>{t("minutes")}</span>
          </div>
          <button
            type="button"
            disabled={!canAdvance && !timerRunning}
            onClick={() => setTimerRunning((running) => !running)}
            className="mt-3 w-full rounded bg-primary px-2 py-1.5 font-semibold text-white"
          >
            {timerRunning ? t("stopTimer") : t("startTimer")}
          </button>
          {timerRunning ? (
            <p className="mt-2 text-muted">{t("nextTurn", { minutes: timerMinutes })}</p>
          ) : null}
        </div>
      </details>
      {briefing && !busy && (
        <details className="relative">
          <summary className="cursor-pointer text-xs text-muted">
            {t("briefingTitle", { turn: briefing.turn })}
          </summary>
          <div className="absolute right-0 top-full z-40 mt-2 w-56 rounded-lg border border-card-border bg-card p-3 text-sm shadow-lg">
            <p>{t("briefingFunds", { delta: briefing.fundsDelta })}</p>
            <p>{t("briefingActions", { delta: briefing.actionsDelta })}</p>
            <a className="mt-2 block text-primary" href="/profile">
              {t("viewCharacter")}
            </a>
          </div>
        </details>
      )}
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
