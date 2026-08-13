"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui";
import { useDebounce } from "@/hooks/useDebounce";
import type { Party } from "../types";

/**
 * Name search that yields a {@link Party}. The blacklist editor previously
 * asked the CEO to type 24-character Mongo ids, which no player can obtain
 * through the game, and rendered saved entries as raw hex.
 */
export function PartySearch({
  kind,
  excludeIds,
  onPick,
  disabled,
}: {
  kind: "character" | "corporation";
  excludeIds: string[];
  onPick: (party: Party) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  // Results are stamped with the term that produced them, so "is this stale"
  // and "are we still searching" are derived rather than tracked in their own
  // state. Setting state synchronously in the effect would cascade renders.
  const [answered, setAnswered] = useState<{ term: string; results: Party[] }>({
    term: "",
    results: [],
  });
  const debounced = useDebounce(query, 300);
  const term = debounced.trim();

  useEffect(() => {
    if (term.length < 2) return;
    let cancelled = false;
    const url =
      kind === "character"
        ? `/api/characters/search?limit=8&q=${encodeURIComponent(term)}`
        : `/api/corporations/search?limit=8&q=${encodeURIComponent(term)}`;
    fetch(url)
      .then((res) => (res.ok ? res.json() : { results: [] }))
      .then((json: { results?: Party[] }) => {
        if (!cancelled) setAnswered({ term, results: json.results ?? [] });
      })
      .catch(() => {
        if (!cancelled) setAnswered({ term, results: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [term, kind]);

  const searching = term.length >= 2 && answered.term !== term;
  const visible =
    answered.term === term ? answered.results.filter((r) => !excludeIds.includes(r.id)) : [];

  return (
    <div className="space-y-1">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={disabled}
        placeholder={kind === "character" ? "Search players by name" : "Search companies by name"}
        aria-label={kind === "character" ? "Search players" : "Search companies"}
      />
      {query.trim().length >= 2 && (
        <div className="rounded-lg border border-card-border bg-card-elevated divide-y divide-card-border">
          {searching && visible.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">Searching...</p>
          ) : visible.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">No match.</p>
          ) : (
            visible.map((party) => (
              <button
                key={party.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  onPick(party);
                  setQuery("");
                  setAnswered({ term: "", results: [] });
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-card disabled:opacity-50"
              >
                <span className="truncate">{party.name}</span>
                <span className="shrink-0 text-xs text-muted">
                  {party.ticker ?? (party.sequentialId != null ? `#${party.sequentialId}` : "")}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
