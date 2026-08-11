"use client";

import { useMemo, useState } from "react";
import type { State } from "@/lib/db/types";
import { formatPopulation } from "@/lib/utils/formatters";
import { getDisplayLean, getLeanLabel, getSocialLeanLabel } from "@/lib/utils/demographics";
import { compassDistance, type CompassPoint } from "@/lib/registration/alignment";
import { playersHereSuffix } from "../register/components/playerCountLabels";

type SortKey = "fit" | "population" | "quiet" | "name";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "fit", label: "Closest to my politics" },
  { value: "population", label: "Largest electorate" },
  { value: "quiet", label: "Fewest players" },
  { value: "name", label: "A–Z" },
];

/** Electorate centre of gravity, when the region has derived leans. */
function electorateOf(state: State): CompassPoint | null {
  if (state.cachedEconomicLean == null || state.cachedSocialLean == null) return null;
  return { economic: state.cachedEconomicLean, social: state.cachedSocialLean };
}

interface HomeStatePickerProps {
  states: State[];
  value: string;
  onChange: (stateId: string) => void;
  playerCounts: Record<string, number>;
  /** Candidate position, used by the "closest to my politics" ordering. */
  position: CompassPoint;
  /** UK/JP call these regions rather than states. */
  regionNoun: string;
}

/**
 * Ranked, filterable region list. Replaces the old native `<select>`: the home
 * region decides the electorate a career is fought in, so its lean, size, and
 * player density belong on screen at the moment of choosing.
 */
export function HomeStatePicker({
  states,
  value,
  onChange,
  playerCounts,
  position,
  regionNoun,
}: HomeStatePickerProps) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("fit");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? states.filter((s) => s.name.toLowerCase().includes(q)) : states;

    const decorated = filtered.map((state) => {
      const electorate = electorateOf(state);
      return {
        state,
        electorate,
        distance: electorate ? compassDistance(position, electorate) : null,
        players: playerCounts[state._id] ?? 0,
      };
    });

    const byName = (a: (typeof decorated)[number], b: (typeof decorated)[number]) =>
      a.state.name.localeCompare(b.state.name);

    return decorated.sort((a, b) => {
      switch (sort) {
        case "fit":
          // Regions with no derived lean yet sink below those that have one
          // rather than pretending to be a perfect match at distance 0.
          if (a.distance == null && b.distance == null) return byName(a, b);
          if (a.distance == null) return 1;
          if (b.distance == null) return -1;
          return a.distance - b.distance || byName(a, b);
        case "population":
          return b.state.population - a.state.population || byName(a, b);
        case "quiet":
          return a.players - b.players || byName(a, b);
        default:
          return byName(a, b);
      }
    });
  }, [states, query, sort, position, playerCounts]);

  return (
    <div>
      <div className="mb-2 flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Filter ${states.length} ${regionNoun}s…`}
          aria-label={`Filter ${regionNoun}s by name`}
          className="min-w-0 flex-1 rounded border border-card-border bg-background px-3 py-1.5 text-body focus:border-primary focus:outline-none"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label={`Sort ${regionNoun}s`}
          className="rounded border border-card-border bg-background px-2 py-1.5 text-body-sm text-muted focus:border-primary focus:outline-none"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <p className="rounded border border-dashed border-card-border px-3 py-6 text-center text-body-sm text-muted">
          No {regionNoun}s match &ldquo;{query}&rdquo;.
        </p>
      ) : (
        // A radiogroup rather than a listbox: these are buttons, and exactly
        // one region can be chosen.
        <div
          className="max-h-80 divide-y divide-card-border/60 overflow-y-auto rounded border border-card-border"
          role="radiogroup"
          aria-label={`Home ${regionNoun}`}
        >
          {rows.map(({ state, electorate, players }) => {
            const selected = value === state._id;
            return (
              <div key={state._id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onChange(state._id)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                    selected ? "bg-primary/10" : "bg-card hover:bg-card-elevated"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-8 w-0.5 shrink-0 rounded-full ${
                      selected ? "bg-primary" : "bg-card-border"
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium">{state.name}</span>
                    <span className="block truncate font-mono text-body-xs text-muted">
                      {/* The headline word uses getDisplayLean (dominant axis), not the raw
                          economic value: some era models (e.g. UK 1953) keep economicLean
                          negative and socialLean positive in EVERY region by construction —
                          only the social axis's magnitude flips which one dominates region to
                          region. Showing raw economic alone made every region read identically
                          "Center-Left" here regardless of true lean; see uk1953.test.ts. */}
                      {electorate
                        ? `${getLeanLabel(getDisplayLean(electorate.economic, electorate.social))} · ${getSocialLeanLabel(electorate.social)}`
                        : "Lean not yet derived"}
                    </span>
                  </span>
                  <span className="shrink-0 text-right font-mono text-body-xs text-muted">
                    <span className="block">{formatPopulation(state.population)}</span>
                    <span className="block">{playersHereSuffix(players)}</span>
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
