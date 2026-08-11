"use client";

// Standalone entry point for the account cockpit: a username search that,
// once a player is picked, renders the full AccountDossier. The dossier is
// also reachable contextually via pivots from the Alts / Watchlist / Forensics
// views; this tab is the "look up a specific player" front door.

import { useEffect, useMemo, useState } from "react";
import AccountDossier from "./AccountDossier";
import type { AltContext } from "../../alts/altTypes";

interface UserOption {
  id: string;
  username: string;
}

export default function DossierTab({
  context = "admin",
  initialUserId,
}: {
  context?: AltContext;
  /** Deep-link target (e.g. the Users table's Dossier shortcut). The parent
   * should remount this tab (via `key`) when the target changes. */
  initialUserId?: string;
}) {
  const [users, setUsers] = useState<UserOption[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<UserOption | null>(
    initialUserId ? { id: initialUserId, username: "" } : null
  );
  const apiBase = context === "moderator" ? "/api/moderator" : "/api/admin";

  useEffect(() => {
    let live = true;
    fetch(`${apiBase}/users?limit=2000`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (!live) return;
        const raw = Array.isArray(data) ? data : (data.users ?? []);
        setUsers(
          raw.map((u: { id?: string; _id?: string; username?: string }) => ({
            id: String(u.id ?? u._id ?? ""),
            username: u.username ?? "(no username)",
          }))
        );
      })
      .catch(() => live && setUsers([]));
    return () => {
      live = false;
    };
  }, [apiBase]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !users) return [];
    return users.filter((u) => u.username.toLowerCase().includes(q)).slice(0, 10);
  }, [query, users]);

  if (selected) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="text-sm text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded px-1"
        >
          ← Look up another player
        </button>
        <AccountDossier userId={selected.id} context={context} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-3 py-6">
      <div className="text-[11px] uppercase tracking-[0.14em] text-muted">Account dossier</div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a player by username…"
        className="h-10 w-full rounded-lg border border-card-border bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      />
      {query.trim() && (
        <ul className="overflow-hidden rounded-lg border border-card-border bg-card">
          {users === null ? (
            <li className="px-3 py-2 text-xs text-muted">Loading players…</li>
          ) : matches.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted">No matching players.</li>
          ) : (
            matches.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => setSelected(u)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-card-elevated focus-visible:outline-none focus-visible:bg-card-elevated"
                >
                  {u.username}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
