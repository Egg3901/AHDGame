"use client";

import { useEffect, useRef, useState } from "react";

// Mirror of MAX_CAMPAIGN_MANAGERS (lib/campaigns/access.ts). Kept as a literal
// so this client component does not pull the server module (and mongodb) into
// the browser bundle; the server enforces the real cap regardless.
const MAX_MANAGERS = 3;

interface Manager {
  characterId: string;
  name: string;
}

interface SearchResult {
  id: string;
  name: string;
  party?: string;
  officeLabel?: string;
}

interface CampaignManagersPanelProps {
  campaignId: string;
  candidateId: string;
  managers: Manager[];
  canAppoint: boolean;
  onRefresh: () => void;
}

/**
 * Appoint and remove campaign managers. A manager's owning player can take
 * campaign actions alongside the nominee, so a serious campaign can split the
 * work. The backend (POST /api/campaigns/[id]/manager, toggle semantics, up to
 * MAX_CAMPAIGN_MANAGERS) shipped without a surface to drive it — this is that
 * surface. Read-only for non-nominees.
 */
export function CampaignManagersPanel({
  campaignId,
  candidateId,
  managers,
  canAppoint,
  onRefresh,
}: CampaignManagersPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const atCap = managers.length >= MAX_MANAGERS;

  useEffect(() => {
    if (!canAppoint || atCap) {
      setResults([]);
      return;
    }
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const exclude = [candidateId, ...managers.map((m) => m.characterId)].join(",");
        const res = await fetch(
          `/api/characters/search?q=${encodeURIComponent(query.trim())}&limit=6&exclude=${exclude}`
        );
        if (!res.ok) {
          setResults([]);
          return;
        }
        const data = await res.json();
        setResults(Array.isArray(data.results) ? data.results : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, canAppoint, atCap, candidateId, managers]);

  async function toggleManager(managerCharacterId: string, label: string) {
    setBusyId(managerCharacterId);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/manager`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ managerCharacterId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Could not update ${label}.`);
        return;
      }
      setQuery("");
      setResults([]);
      onRefresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-card-border bg-card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Campaign Managers</h3>
        <span className="text-xs text-muted tabular-nums">
          {managers.length} / {MAX_MANAGERS}
        </span>
      </div>
      <p className="mb-3 text-sm text-muted">
        A manager can take campaign actions alongside the candidate. Add up to {MAX_MANAGERS} to
        split fundraising, media, ground game, and research.
      </p>

      {managers.length === 0 ? (
        <p className="text-sm text-muted italic">No managers appointed yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {managers.map((m) => (
            <li
              key={m.characterId}
              className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm"
            >
              <span className="font-medium">{m.name}</span>
              {canAppoint && (
                <button
                  type="button"
                  onClick={() => toggleManager(m.characterId, m.name)}
                  disabled={busyId === m.characterId}
                  className="text-muted transition-colors hover:text-error disabled:opacity-50"
                  aria-label={`Remove ${m.name} as manager`}
                >
                  &times;
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canAppoint && (
        <div className="mt-4">
          {atCap ? (
            <p className="text-xs text-muted">
              Manager slots full. Remove one to appoint someone else.
            </p>
          ) : (
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a character to appoint..."
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
              />
              {(searching || results.length > 0) && (
                <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-card-border bg-card shadow-lg">
                  {searching && results.length === 0 && (
                    <li className="px-3 py-2 text-sm text-muted">Searching...</li>
                  )}
                  {results.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => toggleManager(r.id, r.name)}
                        disabled={busyId === r.id}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-primary/10 disabled:opacity-50"
                      >
                        <span className="font-medium">{r.name}</span>
                        {r.officeLabel && (
                          <span className="text-xs text-muted">{r.officeLabel}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-error">{error}</p>}
    </div>
  );
}
