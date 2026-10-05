"use client";

import { InlineError } from "@/components/ui/InlineError";
import { useEffect, useState } from "react";

interface BlockedPlayer {
  userId: string;
  characterName: string | null;
}

/** Settings list of blocked players, with unblock. Blocking happens on profiles. */
export function BlockedPlayersSection() {
  const [players, setPlayers] = useState<BlockedPlayer[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings/blocked-players")
      .then((res) => (res.ok ? res.json() : { players: [] }))
      .then((data) => {
        if (!cancelled) setPlayers(data.players ?? []);
      })
      .catch(() => {
        if (!cancelled) setPlayers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const unblock = async (userId: string) => {
    setBusy(userId);
    setError("");
    try {
      const res = await fetch("/api/settings/blocked-players", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        setError("Could not unblock. Try again.");
        return;
      }
      setPlayers((list) => (list ?? []).filter((p) => p.userId !== userId));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-8 border-t border-card-border pt-6">
      <h3 className="text-sm font-medium">Blocked players</h3>
      <p className="mt-1 text-xs text-muted">
        Blocked players cannot mail you, and their mail, bio and campaign song are hidden from you.
        Block or report a player from their profile.
      </p>
      {players === null ? (
        <p className="mt-3 text-sm text-muted">Loading…</p>
      ) : players.length === 0 ? (
        <p className="mt-3 text-sm text-muted">You have not blocked anyone.</p>
      ) : (
        <ul className="mt-3 divide-y divide-card-border rounded-lg border border-card-border">
          {players.map((p) => (
            <li key={p.userId} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="truncate text-sm">{p.characterName ?? "Former player"}</span>
              <button
                type="button"
                onClick={() => unblock(p.userId)}
                disabled={busy === p.userId}
                className="rounded-lg border border-card-border px-3 py-1 text-xs font-medium text-muted hover:text-foreground disabled:opacity-50"
              >
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
      <InlineError error={error} className="mt-2 text-xs text-error" />
    </div>
  );
}
