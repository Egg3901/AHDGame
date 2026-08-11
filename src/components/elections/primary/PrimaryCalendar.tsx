"use client";

/**
 * Primary calendar timeline. Vertical layout: one row per primary wave from
 * `PRIMARY_WAVES`, with wave label on the left and a horizontal scroll of
 * per-state chips on the right.
 *
 * Past waves render in muted styling; the current and upcoming waves render
 * with the party-color accent. Selected state shows a highlight ring matching
 * the party color.
 *
 * Phase 4 ships this for the presidential primary surface only. Senate /
 * Gov / House calendars look different — they don't use the staggered-wave
 * model — so this widget is presidential-specific by design.
 *
 * Pure presentational: takes the wave shape + selection + click callback.
 * The view-model (Task 4.4) builds the wave list with `isPast` flags from
 * the live election state.
 *
 * See plan §"Phase 4 — Tasks" 4.2.
 */

export interface CalendarWave {
  /** Display label for the row, e.g. "Super Tuesday" or "T-3 (Nevada + SC)". */
  label: string;
  /** Turns remaining when this wave fires. Higher = earlier in the primary. */
  turnsRemaining: number;
  /** True once the wave's turn has fired (computed from current turn vs primary end). */
  isPast: boolean;
  /** Two-letter state codes voting in this wave. */
  stateIds: string[];
}

export function PrimaryCalendar({
  waves,
  selectedStateId,
  partyColor,
  onSelectState,
  /** Optional: highlight winners post-vote. Map of stateId → winner color hex. */
  winnerColorByState,
  /**
   * Turns remaining until the primary's final (T-0) wave fires. Used to
   * convert each wave's `turnsRemaining` ("turns before primary end") into
   * "turns from now" labels. `null` when the timing is unknown (no
   * primaryEndTime on the election) — the calendar falls back to the
   * historical `T-X` notation.
   */
  turnsToEnd,
}: {
  waves: CalendarWave[];
  selectedStateId: string | null;
  partyColor?: string;
  onSelectState: (stateId: string) => void;
  winnerColorByState?: Record<string, string | undefined>;
  turnsToEnd?: number | null;
}) {
  const accent = partyColor ?? "var(--primary)";

  if (waves.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-4 text-xs text-muted">
        No primary calendar data yet — the wave schedule populates once the primary enters its
        stagger window.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
          Primary Calendar
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-muted">
          Past contests show winner; future shows wave timing
        </span>
      </div>
      <div className="flex max-h-[560px] flex-col gap-3 overflow-y-auto pr-1">
        {waves.map((w) => {
          // `turnsRemaining` is "turns before primary end" (T-5 = Iowa,
          // T-0 = closing wave). To show "from now," subtract from the
          // total turns left in the primary. When `turnsToEnd` is null
          // (no primaryEndTime), fall back to the T-X notation since
          // we have no current-turn anchor to compute "from now" against.
          const firesIn = turnsToEnd != null ? Math.max(0, turnsToEnd - w.turnsRemaining) : null;
          const turnsLabel = w.isPast
            ? "Voted"
            : firesIn == null
              ? `T-${w.turnsRemaining}`
              : firesIn === 0
                ? "Voting now"
                : `In ${firesIn} turn${firesIn === 1 ? "" : "s"}`;
          return (
            <div key={w.turnsRemaining} className="flex items-start gap-3">
              <div className="min-w-[88px] text-right">
                <div className="text-xs font-bold tabular-nums">{turnsLabel}</div>
                <div className="mt-0.5 text-[10px] font-medium leading-tight text-muted">
                  {w.label}
                </div>
              </div>
              <div
                className="self-stretch rounded-full"
                style={{
                  width: 2,
                  background: w.isPast ? "var(--card-border)" : accent,
                  opacity: w.isPast ? 0.6 : 0.9,
                }}
              />
              <div className="flex flex-1 flex-wrap gap-1.5">
                {w.stateIds.map((stateId) => {
                  const isSelected = stateId === selectedStateId;
                  const winnerColor = winnerColorByState?.[stateId];
                  const showWinner = w.isPast && winnerColor;
                  const baseClasses =
                    "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold cursor-pointer transition-colors";
                  const muted = !isSelected && !showWinner;
                  // Split `borderColor` (shorthand) into the three non-left
                  // sides when a winner color is set on the left edge —
                  // React rejects mixing shorthand + non-shorthand for the
                  // same property. The base path (no winner) keeps using
                  // `borderColor` since all four sides share one value.
                  const otherSidesColor = isSelected
                    ? accent
                    : showWinner
                      ? `color-mix(in srgb, ${winnerColor} 50%, transparent)`
                      : "var(--card-border)";
                  const borderColorStyle = showWinner
                    ? {
                        borderTopColor: otherSidesColor,
                        borderRightColor: otherSidesColor,
                        borderBottomColor: otherSidesColor,
                        borderLeftColor: winnerColor,
                        borderLeftWidth: 3,
                      }
                    : { borderColor: otherSidesColor };
                  return (
                    <button
                      key={stateId}
                      type="button"
                      onClick={() => onSelectState(stateId)}
                      className={`${baseClasses} ${muted ? "hover:bg-[var(--card-muted)]" : ""}`}
                      style={{
                        ...borderColorStyle,
                        outline: isSelected ? `2px solid ${accent}` : undefined,
                        backgroundColor: isSelected
                          ? `color-mix(in srgb, ${accent} 10%, transparent)`
                          : undefined,
                      }}
                      title={showWinner ? `${stateId} — voted` : `${stateId} — upcoming`}
                    >
                      {stateId}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
