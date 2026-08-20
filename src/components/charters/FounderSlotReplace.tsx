"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

/**
 * Suggestion #287 — inline control on an UNSIGNED founder slot that lets a
 * founder-owner swap the inactive founder for a willing replacement while the
 * charter is still `pending-signatures`.
 *
 * Search is name-based against `/api/characters/search` scoped to the charter's
 * country. Eligibility (human-owned, adjacency to the anchor founder's home
 * state, not already a founder) is enforced server-side by the replace-founder
 * route, so a rejected pick surfaces the route's error message rather than
 * being pre-filtered here.
 */
interface CharacterSearchResult {
  id: string;
  name: string;
  username: string | null;
  homeState: string | null;
}

interface FounderSlotReplaceProps {
  charterId: string;
  outgoingCharacterId: string;
  countryId: string;
}

export function FounderSlotReplace({
  charterId,
  outgoingCharacterId,
  countryId,
}: FounderSlotReplaceProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CharacterSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = async (q: string) => {
    setQuery(q);
    setError(null);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const params = new URLSearchParams({
        q: q.trim(),
        countryId,
        exclude: outgoingCharacterId,
        limit: "8",
      });
      const res = await fetch(`/api/characters/search?${params.toString()}`);
      const data = (await res.json()) as { results?: CharacterSearchResult[] };
      setResults(data.results ?? []);
    } catch {
      setError("Search failed");
    } finally {
      setSearching(false);
    }
  };

  const replaceWith = async (replacementCharacterId: string) => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/charters/${charterId}/replace-founder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outgoingCharacterId, replacementCharacterId }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Failed to replace founder");
        setSubmitting(false);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Replace
      </Button>
    );
  }

  return (
    <div className="mt-2 w-full space-y-2 rounded-md border border-card-border bg-background/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">Replace this founder</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[10px] uppercase tracking-wide text-muted hover:underline"
        >
          Cancel
        </button>
      </div>
      <input
        value={query}
        onChange={(e) => runSearch(e.target.value)}
        placeholder="Search by character or player name…"
        className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
      />
      {searching && <p className="text-xs text-muted">Searching…</p>}
      {results.length > 0 && (
        <ul className="space-y-1">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                disabled={submitting}
                onClick={() => replaceWith(r.id)}
                className="flex w-full items-center justify-between rounded-md border border-card-border bg-card px-3 py-2 text-left text-sm hover:border-primary/50 disabled:opacity-50"
              >
                <span className="font-medium">{r.name}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted">
                  {r.username ?? r.homeState ?? ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <div className="rounded-md border border-error/40 bg-error/10 p-2 text-xs text-error">
          {error}
        </div>
      )}
    </div>
  );
}
