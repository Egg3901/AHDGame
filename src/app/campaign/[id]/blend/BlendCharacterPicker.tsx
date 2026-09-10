"use client";

import { useEffect, useRef, useState } from "react";
import { BLEND, FONT } from "@/components/blend/tokens";

export interface PickerResult {
  id: string;
  name: string;
  party?: string;
  officeLabel?: string;
}

export interface BlendCharacterPickerProps {
  placeholder: string;
  /** Character ids that must not appear in results. */
  excludeIds: string[];
  onPick: (result: PickerResult) => void;
  disabled?: boolean;
}

/**
 * Search-and-pick used by both the ticket (running mate) and the manager slots,
 * styled for Blend. Queries the shared character search endpoint, debounced,
 * and excludes anyone who already holds the role.
 */
export function BlendCharacterPicker({
  placeholder,
  excludeIds,
  onPick,
  disabled = false,
}: BlendCharacterPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Join once so the effect does not re-run on every re-render of the array.
  const exclude = excludeIds.join(",");

  useEffect(() => {
    if (disabled || query.trim().length < 2) {
      setResults([]);
      return;
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/characters/search?q=${encodeURIComponent(query.trim())}&limit=4&exclude=${exclude}`
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
  }, [query, exclude, disabled]);

  const showEmpty = query.trim().length >= 2 && !searching && results.length === 0;

  return (
    <div style={{ marginTop: 10 }}>
      <input
        value={query}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setQuery(e.target.value)}
        style={{
          width: "100%",
          border: `1px solid ${BLEND.hairlineStrong}`,
          background: BLEND.field,
          padding: "8px 10px",
          font: "inherit",
          fontFamily: FONT.serif,
          fontSize: 13,
          color: BLEND.ink,
        }}
      />
      {results.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => {
            setQuery("");
            setResults([]);
            onPick(r);
          }}
          style={{
            display: "flex",
            width: "100%",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 10,
            border: `1px solid ${BLEND.hairlineStrong}`,
            borderTop: 0,
            background: BLEND.inset,
            padding: "8px 10px",
            textAlign: "left",
            cursor: "pointer",
            font: "inherit",
            color: BLEND.ink,
          }}
        >
          <span style={{ fontFamily: FONT.serif, fontSize: 13.5, fontWeight: 600 }}>{r.name}</span>
          <span style={{ fontFamily: FONT.mono, fontSize: 9.5, color: BLEND.mutedDim }}>
            {r.officeLabel ?? r.party ?? ""}
          </span>
        </button>
      ))}
      {showEmpty ? (
        <div
          style={{
            border: `1px solid ${BLEND.hairlineStrong}`,
            borderTop: 0,
            background: BLEND.inset,
            padding: "8px 10px",
            fontFamily: FONT.serif,
            fontStyle: "italic",
            fontSize: 12.5,
            color: BLEND.mutedDim,
          }}
        >
          No characters match.
        </div>
      ) : null}
    </div>
  );
}
