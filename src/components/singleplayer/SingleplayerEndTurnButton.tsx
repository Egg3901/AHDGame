"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The one control a singleplayer world needs that multiplayer never shows:
 * turns advance when the player says so, not on a clock. Calls the same
 * admin endpoint the staff dashboard uses; the local account is an admin.
 */
export function SingleplayerEndTurnButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endTurn = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/turn/process", { method: "POST" });
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
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={endTurn}
        disabled={busy}
        title={error ?? "Advance the world by one turn"}
        className="ml-1 inline-flex items-center gap-2 rounded border border-primary/60 bg-primary/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-primary transition hover:bg-primary/20 disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? (
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        ) : null}
        {busy ? "Running turn" : "End turn"}
      </button>
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
