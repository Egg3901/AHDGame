"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Image from "next/image";
import { useDebounce } from "@/hooks/useDebounce";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";

interface SearchResult {
  id: string;
  userId: string | null;
  name: string;
  username: string | null;
  discordUsername: string | null;
  party: string;
  homeState: string;
  avatarUrl?: string;
  currentOffice: string | null;
}

interface PlayerSelectorProps {
  onSelect: (character: SearchResult) => void;
  placeholder?: string;
  excludeIds?: string[];
  partyFilter?: string;
  countryId?: string;
  className?: string;
}

export function PlayerSelector({
  onSelect,
  placeholder = "Search for a player...",
  excludeIds = [],
  partyFilter,
  countryId,
  className = "",
}: PlayerSelectorProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Stabilize excludeIds to prevent infinite re-render loop —
  // the default [] is a new reference each render, so compare by value
  const excludeKey = JSON.stringify(excludeIds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableExcludeIds = useMemo(() => excludeIds, [excludeKey]);

  const debouncedQuery = useDebounce(query, 300);

  const fetchResults = useCallback(
    async (searchQuery: string) => {
      // Cancel previous request if it exists
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          q: searchQuery,
          limit: "3",
          ...(partyFilter && { party: partyFilter }),
          ...(countryId && { countryId }),
          ...(stableExcludeIds.length > 0 && { exclude: stableExcludeIds.join(",") }),
        });

        const res = await fetch(`/api/characters/search?${params}`, {
          signal: abortControllerRef.current.signal,
        });
        const data = await res.json();

        setResults(data.results || []);
        setIsOpen(data.results?.length > 0);
        setSelectedIndex(0);
      } catch (error) {
        // Don't log AbortError as it's expected when cancelling requests
        if ((error as Error).name !== "AbortError") {
          console.error("Failed to search characters:", error);
          setResults([]);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [partyFilter, countryId, stableExcludeIds]
  );

  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    fetchResults(debouncedQuery);
  }, [debouncedQuery, fetchResults]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(character: SearchResult) {
    onSelect(character);
    setQuery(character.name);
    setIsOpen(false);
    setResults([]);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen || results.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % results.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
        break;
      case "Enter":
        e.preventDefault();
        if (results[selectedIndex]) {
          handleSelect(results[selectedIndex]);
        }
        break;
      case "Escape":
        setIsOpen(false);
        break;
    }
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder={placeholder}
          className="w-full px-4 py-2.5 rounded-lg border border-card-border bg-card text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
        />

        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div className="absolute z-50 w-full mt-2 rounded-lg border border-card-border bg-card shadow-modal overflow-hidden">
          {results.map((result, idx) => (
            <button
              key={result.id}
              onClick={() => handleSelect(result)}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={`
                w-full px-4 py-3 flex items-center gap-3 text-left transition-colors
                ${idx === selectedIndex ? "bg-primary/10" : "hover:bg-card-elevated"}
                ${idx !== results.length - 1 ? "border-b border-card-border" : ""}
              `}
            >
              {result.avatarUrl ? (
                <Image
                  src={result.avatarUrl}
                  alt={result.name}
                  width={40}
                  height={40}
                  className="rounded-lg object-cover border border-card-border"
                  unoptimized={bypassNextImageOptimization(result.avatarUrl)}
                />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center border border-card-border">
                  <span className="text-lg font-bold text-primary">
                    {result.name[0].toUpperCase()}
                  </span>
                </div>
              )}

              <div className="flex-1 min-w-0">
                <div className="font-semibold text-foreground truncate">{result.name}</div>
                <div className="text-xs text-muted flex items-center gap-2">
                  <span>{result.party}</span>
                  <span>•</span>
                  <span>{result.homeState}</span>
                </div>
                <div className="text-[10px] text-muted/60 flex items-center gap-2 mt-0.5">
                  {result.username && <span>@{result.username}</span>}
                  {result.discordUsername && (
                    <>
                      <span>•</span>
                      <span className="text-indigo-400/60">{result.discordUsername}</span>
                    </>
                  )}
                </div>
              </div>

              {result.currentOffice && (
                <div className="text-xs px-2 py-1 rounded bg-card-elevated text-muted border border-card-border">
                  {result.currentOffice}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {isOpen && results.length === 0 && query.length >= 2 && !isLoading && (
        <div className="absolute z-50 w-full mt-2 rounded-lg border border-card-border bg-card shadow-modal p-4 text-center text-muted text-sm">
          No players found matching &quot;{query}&quot;
        </div>
      )}
    </div>
  );
}
