"use client";

import { useMemo, useState } from "react";
import { BLEND, FONT } from "@/components/blend/tokens";

export interface PickerOption {
  id: string;
  name: string;
  party?: string | null;
}

/**
 * Type-to-filter over a list the caller already holds.
 *
 * The sibling `BlendCharacterPicker` searches every character in the game,
 * which is right for naming a running mate and wrong for choosing an
 * opposition-research target: only the candidates standing against you in this
 * race are eligible, and a picker that offers anyone else offers targets the
 * server refuses.
 *
 * Filtering a supplied list rather than querying also means the field is
 * useful before it is typed in — opening it shows the whole field, so a player
 * who does not know who is running can still choose.
 */
export function BlendOptionPicker({
  placeholder,
  options,
  onPick,
  disabled = false,
}: {
  placeholder: string;
  options: PickerOption[];
  onPick: (id: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <div>
      <input
        value={query}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={placeholder}
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
      {matches.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => {
            setQuery("");
            onPick(o.id);
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
          <span
            style={{
              fontFamily: FONT.serif,
              fontSize: 13.5,
              fontWeight: 600,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {o.name}
          </span>
          {o.party ? (
            <span
              style={{
                fontFamily: FONT.mono,
                fontSize: 9.5,
                color: BLEND.mutedDim,
                flexShrink: 0,
              }}
            >
              {o.party}
            </span>
          ) : null}
        </button>
      ))}
      {matches.length === 0 ? (
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
          Nobody in the field matches.
        </div>
      ) : null}
    </div>
  );
}
