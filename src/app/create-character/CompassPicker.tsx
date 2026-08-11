"use client";

import { useCallback, useRef } from "react";
import { POLICY_INTEGER_AXIS_RANGE } from "@/lib/utils/politics";
import type { CompassPoint } from "@/lib/registration/alignment";

const RANGE = POLICY_INTEGER_AXIS_RANGE;

/**
 * Percentage of the square reserved on each edge for the axis captions, so no
 * marker can ever sit underneath "LEFT" / "TRADITIONAL" and so a ±5 position
 * still has room for its label.
 */
const PAD = 11;

export interface CompassParty extends CompassPoint {
  id: string;
  name: string;
  abbreviation: string;
  color: string;
}

export interface CompassElectorate extends CompassPoint {
  label: string;
}

/** Policy value → plot percentage inside the padded box. */
function toX(economic: number): number {
  return PAD + ((economic + RANGE) / (RANGE * 2)) * (100 - PAD * 2);
}
/** Traditional (+social) sits at the top, matching `PoliticalCompass`. */
function toY(social: number): number {
  return PAD + ((RANGE - social) / (RANGE * 2)) * (100 - PAD * 2);
}

function clampStep(n: number): number {
  return Math.max(-RANGE, Math.min(RANGE, Math.round(n)));
}

interface CompassPickerProps {
  value: CompassPoint;
  onChange: (next: CompassPoint) => void;
  parties: CompassParty[];
  electorate: CompassElectorate | null;
  /** Party the player has joined — drawn larger than the rest. */
  selectedPartyId?: string;
  /** Closest party by policy distance — also drawn larger. */
  highlightPartyId?: string;
  /** Hex colour for the candidate pin — usually the selected party's colour. */
  pinColor?: string;
}

/**
 * Draggable two-axis policy plot. The candidate, every party in the country,
 * and the home region's electorate share one plane, so the player can see the
 * policy distances that actually drive elections before committing to them.
 */
export function CompassPicker({
  value,
  onChange,
  parties,
  electorate,
  selectedPartyId,
  highlightPartyId,
  pinColor,
}: CompassPickerProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const setFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const rect = plotRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      const span = (100 - PAD * 2) / 100;
      const fx = ((clientX - rect.left) / rect.width - PAD / 100) / span;
      const fy = ((clientY - rect.top) / rect.height - PAD / 100) / span;
      onChange({
        economic: clampStep(fx * RANGE * 2 - RANGE),
        social: clampStep(RANGE - fy * RANGE * 2),
      });
    },
    [onChange]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Ignore secondary buttons so right-click never yanks the pin.
    if (e.button !== 0) return;
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    setFromPointer(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    setFromPointer(e.clientX, e.clientY);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
    };
    const move = delta[e.key];
    if (!move) return;
    e.preventDefault();
    onChange({
      economic: clampStep(value.economic + move[0]),
      social: clampStep(value.social + move[1]),
    });
  };

  const px = toX(value.economic);
  const py = toY(value.social);
  const accent = pinColor ?? "var(--color-primary)";

  return (
    <div
      ref={plotRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className="relative aspect-square w-full touch-none select-none overflow-hidden rounded-md border border-card-border bg-card-muted"
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
        {/* Grid: one line per policy step, heavier on the two centre axes. */}
        {Array.from({ length: RANGE * 2 + 1 }, (_, i) => {
          const p = PAD + (i / (RANGE * 2)) * (100 - PAD * 2);
          const major = i === RANGE;
          return (
            <g key={i}>
              <line
                x1={p}
                y1={PAD}
                x2={p}
                y2={100 - PAD}
                stroke="currentColor"
                className={major ? "text-muted" : "text-card-border"}
                strokeWidth={major ? 0.45 : 0.22}
              />
              <line
                x1={PAD}
                y1={p}
                x2={100 - PAD}
                y2={p}
                stroke="currentColor"
                className={major ? "text-muted" : "text-card-border"}
                strokeWidth={major ? 0.45 : 0.22}
              />
            </g>
          );
        })}

        {/* Crosshair from the candidate pin out to the plot edges. */}
        <line
          x1={px}
          y1={PAD}
          x2={px}
          y2={100 - PAD}
          stroke={accent}
          strokeWidth="0.4"
          strokeDasharray="1.5 1.5"
          opacity="0.6"
        />
        <line
          x1={PAD}
          y1={py}
          x2={100 - PAD}
          y2={py}
          stroke={accent}
          strokeWidth="0.4"
          strokeDasharray="1.5 1.5"
          opacity="0.6"
        />

        {/* Electorate of the chosen home region. */}
        {electorate && (
          <g>
            <circle
              cx={toX(electorate.economic)}
              cy={toY(electorate.social)}
              r="3.2"
              fill="none"
              stroke="currentColor"
              className="text-foreground"
              strokeWidth="0.8"
            />
            <circle
              cx={toX(electorate.economic)}
              cy={toY(electorate.social)}
              r="0.8"
              fill="currentColor"
              className="text-foreground"
            />
            <title>{electorate.label}</title>
          </g>
        )}

        {/* Party platforms. Stored party colours are arbitrary hexes and some
            sit on top of the theme background (the CDU is #000000), so every
            dot carries a foreground-tinted ring to stay visible in all themes. */}
        {parties.map((p) => {
          const r = p.id === selectedPartyId || p.id === highlightPartyId ? 2.5 : 1.8;
          return (
            <g key={p.id}>
              <circle
                cx={toX(p.economic)}
                cy={toY(p.social)}
                r={r + 0.7}
                fill="none"
                stroke="currentColor"
                className="text-foreground"
                strokeWidth="0.6"
                opacity="0.55"
              />
              <circle cx={toX(p.economic)} cy={toY(p.social)} r={r} fill={p.color}>
                <title>
                  {p.name} — economic {p.economic}, social {p.social}
                </title>
              </circle>
            </g>
          );
        })}
      </svg>

      {/* Axis captions, sitting in the reserved padding. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 font-mono text-body-xs uppercase tracking-[0.16em] text-muted"
      >
        <span className="absolute left-1 top-1/2 -translate-y-1/2 [writing-mode:vertical-rl] rotate-180">
          Left
        </span>
        <span className="absolute right-1 top-1/2 -translate-y-1/2 [writing-mode:vertical-rl]">
          Right
        </span>
        <span className="absolute left-1/2 top-1 -translate-x-1/2">Traditional</span>
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2">Liberal</span>
      </div>

      {/* The candidate pin. Focusable and arrow-key driven. */}
      <button
        type="button"
        onKeyDown={handleKeyDown}
        aria-label={`Your policy position: economic ${value.economic}, social ${value.social}. Use arrow keys to adjust.`}
        className="absolute z-10 h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-background shadow-panel outline-none ring-1 ring-foreground/60 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card-muted active:cursor-grabbing"
        style={{ left: `${px}%`, top: `${py}%`, backgroundColor: accent }}
      />
    </div>
  );
}
