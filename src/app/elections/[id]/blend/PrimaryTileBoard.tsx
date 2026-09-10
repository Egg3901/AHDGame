"use client";

import { FONT } from "@/components/blend/tokens";
import type { PrimaryTileVM } from "./primaryBlendViewModel";

interface PrimaryTileBoardProps {
  tiles: PrimaryTileVM[];
  selectedStateId: string | null;
  onSelect: (stateId: string) => void;
  /** 11 on desktop, 6 on mobile, matching the general screen's board. */
  columns: number;
}

/**
 * The primary state board: one tile per state on the party's calendar,
 * coloured by whoever leads it.
 *
 * Follows the general screen's board shape, but the tiles are buttons rather
 * than divs. Choosing a state is how the carve-up below is driven, so each one
 * has to be reachable from the keyboard and has to say whether it is the
 * current selection.
 */
export function PrimaryTileBoard({
  tiles,
  selectedStateId,
  onSelect,
  columns,
}: PrimaryTileBoardProps) {
  if (tiles.length === 0) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 4 }}>
      {tiles.map((t) => {
        const selected = t.stateId === selectedStateId;
        return (
          <button
            key={t.stateId}
            type="button"
            title={t.title}
            aria-label={t.title}
            aria-pressed={selected}
            onClick={() => onSelect(t.stateId)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 1,
              aspectRatio: "1",
              padding: 0,
              border: "none",
              cursor: "pointer",
              color: t.ink,
              background: t.background,
              // Selection is drawn with an inset shadow rather than an outline
              // so it reads against any fill on a tile sitting flush against
              // its neighbours, and, more importantly, so it leaves `outline`
              // free for the browser's own focus ring. Setting outline here
              // would have taken the focus ring away from keyboard users on
              // every tile that is not the current selection.
              boxShadow: selected ? `inset 0 0 0 2px ${t.ink}` : "none",
            }}
          >
            <span style={{ fontFamily: FONT.mono, fontSize: 10.5, fontWeight: 700 }}>
              {t.stateId}
            </span>
            {t.voted ? (
              <span style={{ fontFamily: FONT.mono, fontSize: 9, opacity: 0.75 }}>✓</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
