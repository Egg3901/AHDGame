"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui";

/**
 * Phase 6 D6 wizard helper. Typeahead picker that searches existing
 * characters by name (debounced) via `/api/characters/search` and emits
 * the selected character's `userId` to the parent. Replaces the raw
 * 24-char-hex userId inputs on `/charters/new`.
 *
 * Country-scoped: only characters whose `countryId` matches the charter
 * country are returned, mirroring the F5 server-side check that
 * cross-country founders are rejected at draft time.
 *
 * Excludes the userIds of already-selected founders so each slot picks
 * a distinct player.
 */
interface SearchResult {
  id: string;
  userId: string | null;
  name: string;
  party: string;
  homeState: string;
  avatarUrl?: string;
  currentOffice: string | null;
}

interface FounderPickerProps {
  /** Country to scope the search to (charter's countryId, lowercase or upper). */
  countryId: string;
  /** Currently-selected characterId for this slot, if any. */
  value: string;
  /** Display name for the currently-selected character; controlled by the parent. */
  displayName: string;
  /** Other founder characterIds to exclude from search results (no duplicates). */
  excludeCharacterIds: string[];
  /**
   * Home states a founder may live in (proposer's home state + its
   * adjacency). When provided, results outside this set are disabled —
   * mirrors the server-side `founder-not-adjacent` rejection. Null/absent
   * disables the filter (legacy proposer without a homeState).
   */
  allowedHomeStates?: string[] | null;
  /** Fired when the user picks a result. Emits the selection's characterId + character name. */
  onSelect: (selection: { characterId: string; characterName: string }) => void;
  /** Fired when the user clears the field. */
  onClear: () => void;
  placeholder?: string;
}

export function FounderPicker({
  countryId,
  value,
  displayName,
  excludeCharacterIds,
  allowedHomeStates,
  onSelect,
  onClear,
  placeholder = "Search by character name…",
}: FounderPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close the dropdown on outside click.
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Debounced search. Skip when a value is already selected (parent decides
  // when to clear) or when the query is too short.
  useEffect(() => {
    if (value) return;
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          q: query.trim(),
          countryId: countryId.toUpperCase(),
          limit: "8",
        });
        const res = await fetch(`/api/characters/search?${params}`);
        if (!res.ok) {
          setResults([]);
          return;
        }
        const data = (await res.json()) as { results: SearchResult[] };
        // Drop NPC / system characters (no userId) — only human-owned
        // characters can sign a charter. Same-character duplicates are
        // shown disabled below so the user sees why they can't pick the
        // already-selected character a second time.
        const usable = data.results.filter((r) => r.userId !== null);
        setResults(usable);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query, countryId, value, excludeCharacterIds]);

  const handleSelect = (result: SearchResult) => {
    onSelect({ characterId: result.id, characterName: result.name });
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  const handleClear = () => {
    onClear();
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm">
          <span className="font-medium">{displayName}</span>
          <span className="ml-2 font-mono text-[10px] text-muted">{value.slice(0, 8)}…</span>
        </div>
        <button
          type="button"
          onClick={handleClear}
          className="rounded-md border border-card-border bg-card px-3 py-2 text-xs text-muted hover:text-foreground"
        >
          Clear
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && (loading || results.length > 0) && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-card-border bg-card shadow-lg">
          {loading && <li className="px-3 py-2 text-xs text-muted">Searching…</li>}
          {!loading &&
            results.map((r) => {
              const alreadyFounder = excludeCharacterIds.includes(r.id);
              const notAdjacent =
                !alreadyFounder &&
                Array.isArray(allowedHomeStates) &&
                !allowedHomeStates.includes(r.homeState);
              const ineligible = alreadyFounder || notAdjacent;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => !ineligible && handleSelect(r)}
                    disabled={ineligible}
                    className={`flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm ${
                      ineligible ? "cursor-not-allowed text-muted/60" : "hover:bg-background/60"
                    }`}
                    title={
                      alreadyFounder
                        ? "This character is already a founder on another slot — pick a different character."
                        : notAdjacent
                          ? "Co-founders must live in your home state or a state adjacent to it."
                          : undefined
                    }
                  >
                    <span className="font-medium">{r.name}</span>
                    <span className="text-xs text-muted">
                      {r.homeState}
                      {r.currentOffice ? ` · ${r.currentOffice}` : ""}
                    </span>
                    {alreadyFounder && (
                      <span className="ml-auto text-[10px] uppercase tracking-wide text-muted/70">
                        already a founder
                      </span>
                    )}
                    {notAdjacent && (
                      <span className="ml-auto text-[10px] uppercase tracking-wide text-muted/70">
                        not adjacent
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          {!loading && results.length === 0 && query.trim().length >= 2 && (
            <li className="px-3 py-2 text-xs text-muted">No matches</li>
          )}
        </ul>
      )}
    </div>
  );
}
