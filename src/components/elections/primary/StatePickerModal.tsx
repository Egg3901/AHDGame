"use client";

import { useState } from "react";
import type { StateTravelOption } from "@/lib/elections/dto/campaignStatePresence";

interface StatePickerModalProps {
  title: string;
  states: StateTravelOption[];
  /** Where the candidate already is, offered as "current" rather than clickable. */
  currentStateId: string | null;
  playerActions: number;
  busy: boolean;
  onPick: (stateId: string) => void;
  onClose: () => void;
  /**
   * The line under the search box. Defaults to the camping/travel price, which
   * is what `actionCost` means; any caller whose action is priced differently
   * MUST pass its own, or the modal quotes a price the server never charges.
   */
  footnote?: string;
  /** Trailing label per row. Defaults to the camping/travel action cost. */
  trailingFor?: (state: StateTravelOption) => string;
  /** Whether a row is unaffordable. Defaults to the camping/travel action cost. */
  unaffordable?: (state: StateTravelOption) => boolean;
}

/**
 * The state chooser behind both moves a candidate can make: camping in a state
 * during the primary, and travelling to one in the general.
 *
 * Shared rather than written twice because the two differ only in the verb.
 * Filtering matches the name as well as the code, which is the whole reason the
 * options carry real state names.
 */
export function StatePickerModal({
  title,
  states,
  currentStateId,
  playerActions,
  busy,
  onPick,
  onClose,
  footnote = "Cost scales by state EV: 3 (small) to 10 actions (large).",
  trailingFor = (s) => `${s.actionCost} actions`,
  unaffordable = (s) => playerActions < s.actionCost,
}: StatePickerModalProps) {
  const [search, setSearch] = useState("");

  const filtered = search
    ? states.filter(
        (s) =>
          s.name.toLowerCase().includes(search.toLowerCase()) || s.id.includes(search.toUpperCase())
      )
    : states;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="rounded-xl border border-card-border bg-card max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-card-border flex items-center justify-between">
          <h3 className="font-semibold">{title}</h3>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-muted hover:text-foreground p-1"
          >
            ✕
          </button>
        </div>
        <div className="px-4 py-2 border-b border-card-border">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or code…"
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
          />
          <p className="text-[11px] text-muted mt-1">{footnote}</p>
        </div>
        <div className="overflow-y-auto flex-1 p-2">
          {filtered.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted">No state matches that search.</p>
          ) : (
            filtered.map((s) => {
              const canAfford = !unaffordable(s);
              const isCurrent = s.id === currentStateId;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={!canAfford || isCurrent || busy}
                  onClick={() => onPick(s.id)}
                  className={`w-full text-left rounded-lg border px-3 py-2 text-sm transition-colors flex items-center justify-between gap-2 ${
                    isCurrent
                      ? "border-amber-500/50 bg-amber-500/20 text-amber-400"
                      : canAfford
                        ? "border-card-border hover:bg-background"
                        : "border-card-border/40 opacity-40"
                  }`}
                >
                  <span className="font-medium">
                    {s.name} <span className="text-muted text-xs">({s.id})</span>
                  </span>
                  <span className="text-xs text-muted tabular-nums">
                    {isCurrent ? "current" : trailingFor(s)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
